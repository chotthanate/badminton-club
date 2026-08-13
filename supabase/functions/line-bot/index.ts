import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPaymentSummary, compareCourtNames } from "../_shared/paymentSummary.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await request.text();
  const payload = safeJson(rawBody);
  const authorization = request.headers.get("Authorization");

  if (payload?.action === "staff_login") return handleStaffLogin(payload);
  if (payload?.action === "get_live_queue") return handleLiveQueueRequest(payload);

  if (["get_liff_payments", "submit_liff_payment"].includes(payload?.action)) {
    return handlePaymentLiffRequest(payload);
  }

  if (["get_liff_event", "save_liff_nickname", "save_liff_profile", "save_live_profile", "submit_liff_signup", "submit_liff_guest", "cancel_liff_signup"].includes(payload?.action)) {
    return handleLiffRequest(payload);
  }

  if (authorization) {
    return publishFromAdmin(request, rawBody, authorization);
  }

  return receiveLineWebhook(request, rawBody);
});

async function publishFromAdmin(request: Request, rawBody: string, authorization: string) {
  const payload = safeJson(rawBody);
  if (!["publish_event", "change_admin_password", "configure_staff_access"].includes(payload?.action)) {
    return json({ error: "Invalid action" }, 400);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  if (payload.action === "configure_staff_access") {
    return configureStaffAccess(userClient, authData.user, payload);
  }

  if (payload.action === "change_admin_password") {
    const password = typeof payload.password === "string" ? payload.password : "";
    if (password.length < 6 || password.length > 72) {
      return json({ error: "รหัสต้องมี 6-72 ตัวอักษร" }, 400);
    }
    const { data: adminMember, error: adminError } = await userClient
      .from("club_members")
      .select("id, club_id")
      .eq("profile_id", authData.user.id)
      .eq("role", "admin")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (adminError || !adminMember) return json({ error: "Admin only" }, 403);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: passwordError } = await adminClient.auth.admin.updateUserById(authData.user.id, { password });
    if (passwordError) {
      console.error("Admin password update failed", passwordError.message);
      return json({ error: "เปลี่ยนรหัสไม่สำเร็จ" }, 500);
    }
    await adminClient.from("audit_logs").insert({
      club_id: adminMember.club_id,
      actor_id: authData.user.id,
      action: "เปลี่ยนรหัสเข้าเว็บ",
    });
    return json({ ok: true });
  }

  if (!payload.eventId) return json({ error: "Invalid action" }, 400);

  const { data: event, error: eventError } = await userClient
    .from("events")
    .select("id, club_id, status, clubs!inner(line_group_id)")
    .eq("id", payload.eventId)
    .single();
  if (eventError || !event) return json({ error: "ไม่พบรอบเล่น" }, 404);

  const { data: adminMember } = await userClient
    .from("club_members")
    .select("id")
    .eq("club_id", event.club_id)
    .eq("profile_id", authData.user.id)
    .eq("role", "admin")
    .eq("active", true)
    .maybeSingle();
  if (!adminMember) return json({ error: "Admin only" }, 403);

  const club = Array.isArray(event.clubs) ? event.clubs[0] : event.clubs;
  if (!club?.line_group_id) {
    return json({ error: "ยังไม่พบกลุ่ม LINE กรุณาเชิญบอทเข้ากลุ่มและพิมพ์ข้อความ 1 ครั้ง" }, 409);
  }
  if (event.status !== "draft") return json({ error: "รอบนี้ไม่ได้อยู่ในสถานะเตรียมรอบ" }, 409);

  const { error: readyError } = await userClient.from("events")
    .update({ line_publish_ready: true })
    .eq("id", event.id)
    .eq("status", "draft");
  if (readyError) return json({ error: "เตรียมเปิดลงชื่อไม่สำเร็จ" }, 500);

  await userClient.from("audit_logs").insert({
    club_id: event.club_id,
    event_id: event.id,
    actor_id: authData.user.id,
    action: "เตรียมรอบสำหรับคำสั่งเปิดลงชื่อใน LINE",
  });
  return json({ ok: true, command: "เปิดลงชื่อ" });
}

function staffEmail(clubId: string) {
  return `staff+${clubId}@headshot.invalid`;
}

async function handleStaffLogin(payload: any) {
  const clubId = Deno.env.get("LINE_CLUB_ID");
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!clubId || !password) return json({ error: "รหัสสตาฟไม่ถูกต้อง" }, 401);
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await anon.auth.signInWithPassword({ email: staffEmail(clubId), password });
  if (error || !data.user || !data.session) return json({ error: "รหัสสตาฟไม่ถูกต้อง" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: staffMember } = await admin.from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("profile_id", data.user.id)
    .eq("role", "staff")
    .eq("active", true)
    .maybeSingle();
  if (!staffMember) {
    return json({ error: "รหัสสตาฟถูกปิดใช้งานแล้ว" }, 403);
  }
  return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
}

async function configureStaffAccess(userClient: any, user: any, payload: any) {
  const clubId = String(payload?.clubId || "");
  const enabled = payload?.enabled !== false;
  const { data: adminMember, error: memberError } = await userClient.from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("profile_id", user.id)
    .eq("role", "admin")
    .eq("active", true)
    .maybeSingle();
  if (memberError || !adminMember) return json({ error: "Admin only" }, 403);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: existingStaff } = await admin.from("club_members")
    .select("id, profile_id")
    .eq("club_id", clubId)
    .eq("role", "staff")
    .limit(1)
    .maybeSingle();
  if (existingStaff?.profile_id) await admin.auth.admin.deleteUser(existingStaff.profile_id);
  if (!enabled) {
    if (existingStaff?.id) await admin.from("club_members").update({ active: false, profile_id: null }).eq("id", existingStaff.id);
    await admin.from("audit_logs").insert({ club_id: clubId, actor_id: user.id, action: "ปิดใช้งานรหัสสตาฟ" });
    return json({ ok: true, enabled: false });
  }
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (password.length < 6 || password.length > 72) return json({ error: "รหัสสตาฟต้องมี 6-72 ตัวอักษร" }, 400);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: staffEmail(clubId), password, email_confirm: true, user_metadata: { role: "staff", club_id: clubId } });
  if (createError || !created.user) return json({ error: "ตั้งค่ารหัสสตาฟไม่สำเร็จ" }, 500);
  if (existingStaff?.id) {
    const { error } = await admin.from("club_members").update({ profile_id: created.user.id, active: true, display_name: "สตาฟ", nickname: "สตาฟ" }).eq("id", existingStaff.id);
    if (error) return json({ error: "ผูกบัญชีสตาฟไม่สำเร็จ" }, 500);
  } else {
    const { error } = await admin.from("club_members").insert({ club_id: clubId, profile_id: created.user.id, display_name: "สตาฟ", nickname: "สตาฟ", role: "staff", active: true });
    if (error) return json({ error: "สร้างบัญชีสตาฟไม่สำเร็จ" }, 500);
  }
  await admin.from("audit_logs").insert({ club_id: clubId, actor_id: user.id, action: "ตั้งหรือเปลี่ยนรหัสสตาฟ" });
  return json({ ok: true, enabled: true });
}

async function receiveLineWebhook(request: Request, rawBody: string) {
  const payload = safeJson(rawBody);
  if (Array.isArray(payload?.events) && payload.events.length === 0) {
    return json({ ok: true });
  }

  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
  const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const clubId = Deno.env.get("LINE_CLUB_ID");
  if (!channelSecret || !lineToken || !clubId) {
    return json({ error: "LINE secrets are not configured" }, 503);
  }

  const signature = request.headers.get("x-line-signature") || "";
  if (!(await verifyLineSignature(rawBody, signature, channelSecret))) {
    return json({ error: "Invalid signature" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: configuredClub, error: clubError } = await admin.from("clubs")
    .select("id, name, line_group_id")
    .eq("id", clubId)
    .maybeSingle();
  if (clubError || !configuredClub) return json({ error: "Configured club was not found" }, 500);

  for (const event of payload?.events || []) {
    const groupId = event.source?.groupId;
    if (groupId && !configuredClub.line_group_id) {
      await admin.from("clubs").update({ line_group_id: groupId }).eq("id", clubId);
      configuredClub.line_group_id = groupId;
    }
    if (groupId && configuredClub.line_group_id !== groupId) continue;

    if (event.type === "message" && event.message?.type === "text") {
      const command = normalizeLineCommand(event.message.text);
      const groupCommands = ["เปิดลงชื่อ", "ลงชื่อ", "รายชื่อตีแบดวันนี้", "แจ้งโอน", "ชำระเงิน", "คิว"];
      const privateCommands = ["ลงชื่อ", "รายชื่อตีแบดวันนี้", "แจ้งโอน", "ชำระเงิน", "คิว"];
      const isPrivateChat = event.source?.type === "user" && !groupId;
      if (isPrivateChat && command === "เปิดลงชื่อ") {
        await replyLine(event.replyToken, "คำสั่งเปิดลงชื่อใช้ในกลุ่มหลักเท่านั้น หากต้องการดูตัวอย่างการ์ดให้พิมพ์ ลงชื่อ", lineToken);
      } else if ((groupId && groupCommands.includes(command)) || (isPrivateChat && privateCommands.includes(command))) {
        await handleSignupCommand({
          admin,
          club: configuredClub,
          command,
          event,
          lineToken,
        });
      }
      continue;
    }

    if (event.type !== "postback" || !event.source?.userId) continue;
    const data = new URLSearchParams(event.postback?.data || "");
    if (data.get("action") !== "signup") continue;

    const eventId = data.get("event_id");
    const status = data.get("status");
    if (!eventId || !["coming", "not_coming"].includes(status || "")) continue;

    if (status === "coming") {
      await replyLine(event.replyToken, "กรุณากดปุ่มลงชื่อในการ์ดล่าสุดเพื่อเลือกเวลาที่จะไป", lineToken);
      continue;
    }

    const { data: badmintonEvent } = await admin.from("events")
      .select("id, club_id, status")
      .eq("id", eventId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (!badmintonEvent || badmintonEvent.status !== "open") {
      await replyLine(event.replyToken, "รอบนี้ปิดรับคำตอบแล้ว", lineToken);
      continue;
    }

    const displayName = await getLineDisplayName(event.source, lineToken);
    const { data: existingMember } = await admin.from("club_members")
      .select("id")
      .eq("club_id", clubId)
      .eq("line_user_id", event.source.userId)
      .maybeSingle();

    let memberId = existingMember?.id;
    if (!memberId) {
      const { data: newMember, error } = await admin.from("club_members").insert({
        club_id: clubId,
        display_name: displayName,
        line_user_id: event.source.userId,
        role: "member",
      }).select("id").single();
      if (error) throw error;
      memberId = newMember.id;
    } else {
      await admin.from("club_members").update({ display_name: displayName }).eq("id", memberId);
    }

    await admin.from("signups").upsert({
      club_id: clubId,
      event_id: eventId,
      member_id: memberId,
      status,
      arrival_time: null,
    }, { onConflict: "event_id,member_id" });

    await admin.from("audit_logs").insert({
      club_id: clubId,
      event_id: eventId,
      actor_id: null,
      action: `${displayName} ตอบ ${signupLabel(status!)}`,
      details: { line_user_id: event.source.userId },
    });
  }

  return json({ ok: true });
}

async function handleSignupCommand({ admin, club, command, event, lineToken }: {
  admin: any;
  club: any;
  command: string;
  event: any;
  lineToken: string;
}) {
  const eventFields = "id, club_id, event_date, venue, status, starts_at, ends_at, line_publish_ready, event_courts(court_name, starts_at, ends_at, position)";
  if (command === "รายชื่อตีแบดวันนี้") {
    const currentEvent = await latestEvent(admin, club.id, eventFields, "open");
    if (!currentEvent) {
      await replyLine(event.replyToken, "ตอนนี้ยังไม่มีรอบที่เปิดให้ลงชื่อ", lineToken);
      return;
    }
    const roster = await getLiffRoster(admin, currentEvent);
    await replyLine(event.replyToken, buildRosterText(currentEvent, roster.coming), lineToken);
    return;
  }

  const liffId = Deno.env.get("LINE_LIFF_ID");
  if (!liffId) {
    await replyLine(event.replyToken, "ระบบลงชื่อ LINE ยังตั้งค่าไม่ครบ", lineToken);
    return;
  }

  if (command === "ลงชื่อ") {
    const currentEvent = await latestEvent(admin, club.id, eventFields, "open");
    if (!currentEvent) {
      await replyLine(event.replyToken, "ตอนนี้ยังไม่มีรอบที่เปิดให้ลงชื่อ", lineToken);
      return;
    }
    await replyLineMessages(event.replyToken, [
      buildSignupMessage(currentEvent, liffId),
    ], lineToken);
    return;
  }

  if (command === "คิว") {
    const currentEvent = await latestEvent(admin, club.id, eventFields, "open");
    if (!currentEvent) {
      await replyLine(event.replyToken, "ตอนนี้ยังไม่มีรอบที่เปิดใช้งานสนามและคิว", lineToken);
      return;
    }
    await replyLineMessages(event.replyToken, [
      buildLiveQueueMessage(currentEvent, liffId),
    ], lineToken);
    await admin.from("audit_logs").insert({
      club_id: club.id,
      event_id: currentEvent.id,
      actor_id: null,
      action: "ส่งการ์ดดูสนามและผู้เล่นคิวถัดไป",
      details: { line_user_id: event.source?.userId, source: "line_command" },
    });
    return;
  }

  if (command === "แจ้งโอน" || command === "ชำระเงิน") {
    const paymentSummary = await latestPaymentSummary(admin, club.id);
    await replyLineMessages(event.replyToken, [
      { type: "text", text: paymentSummary?.text || "ยังไม่มีรายการที่สรุปยอดสำหรับชำระเงิน" },
      buildPaymentMessage(liffId),
    ], lineToken);
    await admin.from("audit_logs").insert({
      club_id: club.id,
      event_id: paymentSummary?.eventId || null,
      actor_id: null,
      action: "ส่งสรุปยอดและการ์ดชำระเงิน",
      details: { line_user_id: event.source?.userId, source: "line_command" },
    });
    return;
  }

  const readyEvent = await latestEvent(admin, club.id, eventFields, "draft", true);
  if (!readyEvent) {
    const currentEvent = await latestEvent(admin, club.id, eventFields, "open");
    const message = currentEvent
      ? "รอบล่าสุดเปิดลงชื่ออยู่แล้ว"
      : "ยังไม่มีรอบที่แอดมินกดเตรียมเปิดลงชื่อจากเว็บไซต์";
    await replyLine(event.replyToken, message, lineToken);
    return;
  }
  if (!(readyEvent.event_courts || []).length) {
    await replyLine(event.replyToken, "รอบนี้ยังไม่มีคอร์ท กรุณาเพิ่มคอร์ทในเว็บไซต์ก่อน", lineToken);
    return;
  }

  const { data: claimedEvent, error: claimError } = await admin.from("events")
    .update({ status: "open", line_publish_ready: false })
    .eq("id", readyEvent.id)
    .eq("status", "draft")
    .eq("line_publish_ready", true)
    .select("id")
    .maybeSingle();
  if (claimError || !claimedEvent) {
    await replyLine(event.replyToken, "รอบนี้ถูกเปิดลงชื่อไปแล้ว", lineToken);
    return;
  }

  try {
    await replyLineMessages(event.replyToken, [
      buildSignupMessage(readyEvent, liffId),
    ], lineToken);
    await admin.from("audit_logs").insert({
      club_id: club.id,
      event_id: readyEvent.id,
      actor_id: null,
      action: "เปิดลงชื่อด้วย Reply API จากกลุ่ม LINE",
      details: { line_user_id: event.source?.userId, source: "line_command" },
    });
  } catch (error) {
    await admin.from("events")
      .update({ status: "draft", line_publish_ready: true })
      .eq("id", readyEvent.id)
      .eq("status", "open");
    throw error;
  }
}

async function latestEvent(admin: any, clubId: string, fields: string, status: string, readyOnly = false) {
  let query = admin.from("events")
    .select(fields)
    .eq("club_id", clubId)
    .eq("status", status);
  if (readyOnly) query = query.eq("line_publish_ready", true);
  const { data, error } = await query
    .order("event_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function normalizeLineCommand(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function buildSignupMessage(event: any, liffId: string) {
  const courts = [...(event.event_courts || [])]
    .sort(compareCourtNames)
    .map((court) => `${court.court_name} : ${time(court.starts_at)}-${displayEndTime(court.ends_at)}`);
  const courtLines = courts.length ? courts : ["ยังไม่ได้ระบุคอร์ท"];
  const cardDate = thaiLongDate(event.event_date).replace("ที่ ", " ที่ ");
  const title = `🏸 ลงชื่อเล่นแบดมินตัน : ${cardDate}`;

  return {
    type: "flex",
    altText: `${title}\nสถานที่ : ${event.venue}\n${courtLines.join("\n")}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🏸 ลงชื่อเล่นแบดมินตัน", weight: "bold", size: "xl", wrap: true },
          { type: "text", text: cardDate, color: "#15966a", weight: "bold" },
          { type: "separator" },
          { type: "text", text: `สถานที่ : ${event.venue}`, size: "sm", wrap: true },
          ...courtLines.map((court) => ({
            type: "text",
            text: court,
            size: "xs",
            color: "#637064",
            wrap: false,
            adjustMode: "shrink-to-fit",
          })),
          { type: "text", text: "\"ตีสนุก ตีมันส์ ง่ายๆ สบายๆ สไตล์ HeadShot\"", size: "sm", color: "#15966a", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#15966a",
            action: {
              type: "uri",
              label: "ลงเวลา",
              uri: `https://liff.line.me/${liffId}?event_id=${event.id}`,
            },
          },
        ],
      },
    },
  };
}

function buildPaymentMessage(liffId: string) {
  return {
    type: "flex",
    altText: "ชำระค่าตีแบด · ตรวจยอดค้างและแนบสลิป",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "💸 ชำระค่าตีแบด", weight: "bold", size: "xl", wrap: true },
          { type: "text", text: "กดปุ่มด้านล่างเพื่อเลือกยอดที่ต้องชำระและแนบรูปสลิป", size: "sm", color: "#637064", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{
          type: "button",
          style: "primary",
          color: "#15966a",
          action: {
            type: "uri",
            label: "ชำระเงิน",
            uri: `https://liff.line.me/${liffId}?mode=payment`,
          },
        }],
      },
    },
  };
}

function buildLiveQueueMessage(event: any, liffId: string) {
  return {
    type: "flex",
    altText: "ดูสนามและผู้เล่นคิวถัดไป",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🏸 สนามและคิว", weight: "bold", size: "xl", wrap: true },
          { type: "text", text: event.venue || "Headshot Badminton", size: "sm", color: "#637064", wrap: true },
          { type: "text", text: "ดูผู้เล่นในแต่ละสนาม เวลาเล่น คิวถัดไป และผู้เล่นที่กำลังรอ", size: "sm", color: "#637064", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{
          type: "button",
          style: "primary",
          color: "#15966a",
          action: {
            type: "uri",
            label: "ดูสนามและผู้เล่นคิวถัดไป",
            uri: `https://liff.line.me/${liffId}?liff=live&event_id=${event.id}`,
          },
        }],
      },
    },
  };
}

function buildRosterText(event: any, players: Array<{ name: string; arrivalTime: string | null }>) {
  const courts = [...(event.event_courts || [])]
    .sort(compareCourtNames)
    .map((court) => `${court.court_name} : ${time(court.starts_at)}-${displayEndTime(court.ends_at)} น.`);
  const playerLines = players.length
    ? players.map((player, index) => `${index + 1}. ${player.name} : ${player.arrivalTime ? `${player.arrivalTime} น.` : "ยังไม่ระบุเวลา"}`)
    : ["ยังไม่มีผู้ลงชื่อ"];

  return [
    `รายชื่อตีแบด ${thaiLongDate(event.event_date)}`,
    ...courts,
    ...playerLines,
    "🏸 ใครสนใจลงชื่อเพิ่มเติมสามารถคลิกที่ประกาศด้านบนได้เลยนะครับ",
  ].join("\n");
}

async function latestPaymentSummary(admin: any, clubId: string) {
  const { data: latestPayment, error: latestPaymentError } = await admin.from("payments")
    .select("event_id, billed_at")
    .eq("club_id", clubId)
    .not("billed_at", "is", null)
    .order("billed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestPaymentError) throw latestPaymentError;
  if (!latestPayment?.event_id) return null;

  const eventId = latestPayment.event_id;
  const [eventResult, courtsResult, paymentsResult, signupsResult, extrasResult] = await Promise.all([
    admin.from("events").select("id, event_date, venue").eq("id", eventId).eq("club_id", clubId).maybeSingle(),
    admin.from("event_courts").select("court_name, starts_at, ends_at, position").eq("event_id", eventId),
    admin.from("payments").select("member_id, amount, billed_at").eq("event_id", eventId).not("billed_at", "is", null),
    admin.from("signups").select("member_id, created_at").eq("event_id", eventId).order("created_at"),
    admin.from("member_extra_charges").select("member_id, item_name, unit_price, quantity, created_at").eq("event_id", eventId).order("created_at"),
  ]);
  for (const result of [eventResult, courtsResult, paymentsResult, signupsResult, extrasResult]) {
    if (result.error) throw result.error;
  }
  if (!eventResult.data) return null;

  const memberIds = [...new Set((paymentsResult.data || []).map((payment: any) => payment.member_id))];
  const { data: members, error: membersError } = memberIds.length
    ? await admin.from("club_members").select("id, nickname, display_name, payment_exempt").in("id", memberIds)
    : { data: [], error: null };
  if (membersError) throw membersError;

  const membersById = new Map((members || []).map((member: any) => [member.id, member]));
  const signupOrder = new Map((signupsResult.data || []).map((signup: any, index: number) => [signup.member_id, index]));
  const extrasByMember = new Map<string, any[]>();
  for (const extra of extrasResult.data || []) {
    const current = extrasByMember.get(extra.member_id) || [];
    current.push(extra);
    extrasByMember.set(extra.member_id, current);
  }

  const rows = (paymentsResult.data || [])
    .filter((payment: any) => !membersById.get(payment.member_id)?.payment_exempt)
    .sort((left: any, right: any) => {
      const leftOrder = signupOrder.get(left.member_id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = signupOrder.get(right.member_id) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || String(left.billed_at).localeCompare(String(right.billed_at));
    })
    .map((payment: any) => {
      const member: any = membersById.get(payment.member_id);
      return {
        name: member?.nickname || member?.display_name || "สมาชิก",
        amount: Number(payment.amount || 0),
        extrasText: summarizePaymentExtras(extrasByMember.get(payment.member_id) || []),
      };
    });

  return {
    eventId,
    text: buildPaymentSummary({
      date: eventResult.data.event_date,
      venue: eventResult.data.venue,
      courts: courtsResult.data || [],
      rows,
    }),
  };
}

function summarizePaymentExtras(charges: any[]) {
  const grouped = new Map<string, { quantity: number; amount: number }>();
  for (const charge of charges) {
    const name = String(charge.item_name || "รายการอื่น");
    const current = grouped.get(name) || { quantity: 0, amount: 0 };
    current.quantity += Number(charge.quantity || 1);
    current.amount += Number(charge.unit_price || 0) * Number(charge.quantity || 1);
    grouped.set(name, current);
  }
  return [...grouped.entries()]
    .map(([name, value]) => `${name}${value.quantity > 1 ? `×${value.quantity}` : ""} ${Math.round(value.amount).toLocaleString("th-TH")} บาท`)
    .join(", ");
}

async function handlePaymentLiffRequest(payload: any) {
  const configuredClubId = Deno.env.get("LINE_CLUB_ID");
  if (!configuredClubId) return json({ error: "LINE_CLUB_ID is not configured" }, 503);
  if (!payload?.idToken) return json({ error: "ไม่พบบัญชี LINE สำหรับแจ้งโอน" }, 400);

  try {
    const identity = await verifyLiffIdToken(payload.idToken);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const clubId = await resolveLiffClubId(admin, payload, configuredClubId);
    const { data: submitter, error: submitterError } = await admin.from("club_members")
      .select("id, nickname, display_name, line_user_id")
      .eq("club_id", clubId)
      .eq("line_user_id", identity.sub)
      .eq("active", true)
      .maybeSingle();
    if (submitterError) throw submitterError;

    if (payload.action === "get_liff_payments") {
      const { data: clubMembers, error: memberError } = await admin.from("club_members")
        .select("id, nickname, display_name, line_user_id")
        .eq("club_id", clubId)
        .eq("active", true)
        .order("created_at");
      if (memberError) throw memberError;
      const beneficiaryIds = (clubMembers || []).map((member) => member.id);
      const { data: duePayments, error: paymentError } = beneficiaryIds.length
        ? await admin.from("payments")
          .select("id, member_id, event_id, amount, events!inner(event_date, venue)")
          .eq("club_id", clubId)
          .in("member_id", beneficiaryIds)
          .not("billed_at", "is", null)
          .is("paid_at", null)
          .order("created_at")
        : { data: [], error: null };
      if (paymentError) throw paymentError;
      const paymentsByMember = new Map<string, any[]>();
      for (const payment of duePayments || []) {
        const badmintonEvent = Array.isArray(payment.events) ? payment.events[0] : payment.events;
        const rows = paymentsByMember.get(payment.member_id) || [];
        rows.push({
          id: payment.id,
          eventId: payment.event_id,
          eventDate: badmintonEvent?.event_date,
          venue: badmintonEvent?.venue || "",
          amount: Number(payment.amount || 0),
        });
        paymentsByMember.set(payment.member_id, rows);
      }
      const beneficiaries = [];
      const orderedMembers = [...(clubMembers || [])].sort((left, right) => {
        if (left.id === submitter?.id) return -1;
        if (right.id === submitter?.id) return 1;
        const leftName = left.nickname || left.display_name || "";
        const rightName = right.nickname || right.display_name || "";
        return leftName.localeCompare(rightName, "th");
      });
      for (const member of orderedMembers) {
        const payments = paymentsByMember.get(member.id) || [];
        // Keep the signed-in member in the response even when they have no balance.
        // Older LIFF bundles use profile.memberId as the select value; omitting that
        // option makes iOS display the first other member visually instead.
        if (!payments.length && member.id !== submitter?.id) continue;
        beneficiaries.push({
          id: member.id,
          name: member.nickname || member.display_name || "สมาชิก",
          lineName: member.display_name || "",
          isSelf: member.id === submitter?.id,
          payments,
        });
      }
      return json({
        testMode: Boolean(payload.testMode),
        profile: {
          memberId: submitter?.id || null,
          name: String(identity.name || submitter?.display_name || "สมาชิก LINE").slice(0, 80),
          nickname: submitter?.nickname || "",
        },
        beneficiaries,
      });
    }

    if (!submitter?.id) {
      return json({ error: "ยังไม่พบชื่อของคุณในระบบ กรุณาลงชื่อเล่นแบดอย่างน้อย 1 ครั้งก่อนแจ้งโอน" }, 409);
    }
    const paymentIds = [...new Set(Array.isArray(payload.paymentIds) ? payload.paymentIds.map(String) : [])].slice(0, 60);
    if (!paymentIds.length) {
      return json({ error: "กรุณาเลือกผู้เล่นและรอบที่ต้องการชำระ" }, 400);
    }
    const { data: payments, error: paymentError } = await admin.from("payments")
      .select("id, event_id, member_id, amount, paid_at, billed_at, events!inner(event_date)")
      .eq("club_id", clubId)
      .in("id", paymentIds);
    if (paymentError) throw paymentError;
    if ((payments || []).length !== paymentIds.length
      || (payments || []).some((payment) => payment.paid_at || !payment.billed_at)) {
      return json({ error: "ยอดที่เลือกมีการเปลี่ยนแปลง กรุณาเปิดหน้าแจ้งโอนใหม่" }, 409);
    }
    const beneficiaryMemberIds = [...new Set((payments || []).map((payment) => String(payment.member_id)))];
    const { data: beneficiaries, error: beneficiaryError } = await admin.from("club_members")
      .select("id, nickname, display_name, line_user_id")
      .eq("club_id", clubId)
      .eq("active", true)
      .in("id", beneficiaryMemberIds);
    if (beneficiaryError) throw beneficiaryError;
    if ((beneficiaries || []).length !== beneficiaryMemberIds.length) {
      return json({ error: "มีผู้เล่นที่เลือกไม่อยู่ในระบบแล้ว กรุณาเปิดหน้าชำระเงินใหม่" }, 409);
    }
    const primaryBeneficiary = (beneficiaries || []).find((member) => member.id === submitter.id)
      || (beneficiaries || [])[0];

    const slip = payload.slip || {};
    const slipHash = String(slip.hash || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(slipHash)) return json({ error: "ข้อมูลรูปสลิปไม่ถูกต้อง" }, 400);
    const transactionReference = extractSlipReference(slip.text) || normalizeSlipReference(slip.reference);
    const { data: hashDuplicate } = await admin.from("payment_slips")
      .select("id, status")
      .eq("club_id", clubId)
      .eq("slip_hash", slipHash)
      .maybeSingle();
    let duplicate = hashDuplicate;
    if (!duplicate && transactionReference) {
      const { data: referenceDuplicate, error: referenceDuplicateError } = await admin.from("payment_slips")
        .select("id, status")
        .eq("club_id", clubId)
        .eq("transaction_reference", transactionReference)
        .eq("status", "auto_paid")
        .maybeSingle();
      if (referenceDuplicateError) throw referenceDuplicateError;
      duplicate = referenceDuplicate;
    }
    if (duplicate) {
      if (duplicate.status === "rejected") {
        return json({ error: "รายการโอนนี้เคยถูกตรวจสอบแล้ว กรุณาติดต่อแอดมิน" }, 409);
      }
      return json({
        status: duplicate.status,
        message: duplicate.status === "auto_paid"
          ? "รายการโอนนี้ถูกบันทึกว่าชำระแล้วก่อนหน้านี้"
          : "รายการโอนนี้อยู่ระหว่างรอแอดมินตรวจสอบ",
      });
    }

    const expectedAmount = (payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const transferredAmount = finiteNumber(slip.amount);
    const transferredOn = isoDateValue(slip.transferredOn);
    const confidence = finiteNumber(slip.confidence);
    const recipientStatus = classifySlipRecipient(slip.text);
    if (recipientStatus === "mismatch") {
      return json({
        error: "บัญชีผู้รับไม่ถูกต้อง กรุณาโอนไปยัง นาย ณฐกฤต อินนะใจ เท่านั้น",
      }, 422);
    }
    if (transferredAmount !== null && transferredAmount < expectedAmount - 0.009) {
      return json({
        error: `ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากน้อยกว่ายอดที่ต้องจ่ายจริง (ต้องชำระ ${expectedAmount} บาท แต่สลิปเป็น ${transferredAmount} บาท)`,
      }, 422);
    }
    if (transferredAmount !== null && transferredAmount > expectedAmount + 0.009) {
      return json({
        error: `ยอดเงินที่โอนไม่ถูกต้อง เนื่องจากมากกว่ายอดที่ต้องจ่ายจริง (ต้องชำระ ${expectedAmount} บาท แต่สลิปเป็น ${transferredAmount} บาท)`,
      }, 422);
    }

    const { data: replacedSlips, error: replacedSlipError } = await admin.from("payment_slips")
      .select("id, storage_path")
      .eq("club_id", clubId)
      .eq("status", "pending")
      .overlaps("payment_ids", paymentIds);
    if (replacedSlipError) throw replacedSlipError;

    const eventDates = (payments || []).map((payment) => {
      const badmintonEvent = Array.isArray(payment.events) ? payment.events[0] : payment.events;
      return String(badmintonEvent?.event_date || "");
    }).filter(Boolean);
    const latestEventDate = [...eventDates].sort().at(-1) || null;
    const todayInBangkok = bangkokIsoDate();
    const datePasses = Boolean(
      transferredOn
      && latestEventDate
      && transferredOn >= latestEventDate
      && transferredOn <= todayInBangkok,
    );
    const ocrPasses = confidence !== null
      && confidence >= 35
      && Boolean(transferredOn)
      && transferredAmount !== null
      && recipientStatus === "match"
      && Boolean(transactionReference);
    const autoPaidCandidate = datePasses && ocrPasses;
    const overpaymentAmount = 0;
    const reviewReasons = [
      recipientStatus === "unclear" ? "ระบบอ่านชื่อบัญชีผู้รับไม่ชัด" : "",
      transferredAmount === null ? "ระบบอ่านยอดเงินไม่ชัด" : "",
      !transferredOn ? "ระบบอ่านวันที่โอนไม่ชัด" : "",
      !transactionReference ? "ระบบอ่านเลขอ้างอิงรายการไม่ชัด" : "",
      confidence === null || confidence < 35 ? "ความชัดเจนของข้อความในสลิปต่ำ" : "",
      transferredOn && latestEventDate && transferredOn < latestEventDate ? "วันที่โอนอยู่ก่อนวันที่ตีแบด" : "",
      transferredOn && transferredOn > todayInBangkok ? "วันที่โอนเป็นวันอนาคต" : "",
    ].filter(Boolean);
    const slipId = crypto.randomUUID();
    let storagePath: string | null = null;

    if (typeof slip.dataUrl === "string") {
      const image = decodeDataUrl(slip.dataUrl);
      if (image && image.bytes.byteLength <= 3 * 1024 * 1024) {
        const extension = image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
        storagePath = `${clubId}/${slipId}.${extension}`;
        const { error: uploadError } = await admin.storage.from("payment-slips")
          .upload(storagePath, image.bytes, { contentType: image.mimeType, upsert: false });
        if (uploadError) {
          console.error("Slip upload failed", uploadError.message);
          storagePath = null;
        }
      }
    }
    if (!storagePath) reviewReasons.push("ระบบเก็บรูปสลิปไม่สำเร็จ");
    const autoPaid = autoPaidCandidate && Boolean(storagePath);

    const { error: slipError } = await admin.from("payment_slips").insert({
      id: slipId,
      club_id: clubId,
      submitted_by_member_id: submitter.id,
      beneficiary_member_id: primaryBeneficiary.id,
      beneficiary_member_ids: beneficiaryMemberIds,
      payment_ids: paymentIds,
      expected_amount: expectedAmount,
      transferred_amount: transferredAmount,
      transferred_on: transferredOn,
      ocr_confidence: confidence,
      ocr_text: String(slip.text || "").slice(0, 12000),
      slip_hash: slipHash,
      transaction_reference: transactionReference,
      storage_path: storagePath,
      status: "pending",
      review_reason: reviewReasons.join(" · ") || (autoPaid ? null : "รอแอดมินตรวจสอบ"),
      overpayment_amount: overpaymentAmount,
    });
    if (slipError) throw slipError;

    if ((replacedSlips || []).length) {
      const replacedIds = (replacedSlips || []).map((entry: any) => entry.id);
      const { error: replaceError } = await admin.from("payment_slips").update({
        status: "rejected",
        review_reason: "สมาชิกส่งสลิปใหม่แทนรายการเดิม",
        reviewed_at: new Date().toISOString(),
      }).in("id", replacedIds);
      if (replaceError) {
        console.error("Old slip replacement failed", replaceError.message);
      } else {
        const oldStoragePaths = (replacedSlips || []).map((entry: any) => entry.storage_path).filter(Boolean);
        if (oldStoragePaths.length) {
          const { error: removeError } = await admin.storage.from("payment-slips").remove(oldStoragePaths);
          if (removeError) console.error("Old slip cleanup failed", removeError.message);
        }
      }
    }

    if (autoPaid) {
      const { error: settlementError } = await admin.rpc("settle_payment_slip", {
        target_slip_id: slipId,
        approve: true,
        settlement_source: "slip_auto",
      });
      if (settlementError) {
        console.error("Atomic slip settlement failed", settlementError.message);
        await admin.from("payment_slips").update({
          review_reason: "ระบบปิดยอดพร้อมกันไม่สำเร็จ กรุณาให้แอดมินตรวจสอบ",
        }).eq("id", slipId).eq("status", "pending");
        await admin.from("payments").update({ payment_status: "review" })
          .in("id", paymentIds)
          .is("paid_at", null);
        return json({
          status: "pending",
          message: "ยังไม่ได้เปลี่ยนสถานะเป็นจ่ายแล้ว แอดมินจะตรวจสอบรายการนี้อีกครั้ง",
        });
      }
    } else {
      await admin.from("payments").update({ payment_status: "review" })
        .in("id", paymentIds)
        .is("paid_at", null);
    }

    const beneficiaryNames = beneficiaryMemberIds.map((memberId) => {
      const member = (beneficiaries || []).find((entry) => entry.id === memberId);
      return member?.nickname || member?.display_name || "สมาชิก";
    });
    const beneficiaryName = beneficiaryNames.join(", ");
    await admin.from("audit_logs").insert({
      club_id: clubId,
      actor_id: null,
      action: autoPaid
        ? `ตรวจสลิปและรับเงิน ${beneficiaryName} อัตโนมัติ`
        : `รับสลิปของ ${beneficiaryName} ไว้รอตรวจสอบ`,
      details: {
        source: "liff_payment",
        submitted_by_member_id: submitter.id,
        beneficiary_member_id: primaryBeneficiary.id,
        beneficiary_member_ids: beneficiaryMemberIds,
        payment_ids: paymentIds,
        expected_amount: expectedAmount,
        transferred_amount: transferredAmount,
        overpayment_amount: overpaymentAmount,
        transferred_on: transferredOn,
        slip_id: slipId,
      },
    });

    return json({
      status: autoPaid ? "auto_paid" : "pending",
      message: autoPaid
        ? `ระบบตรวจสลิปผ่านและปิดยอด ${paymentIds.length} รอบเรียบร้อยแล้ว`
        : "ยังไม่ได้เปลี่ยนสถานะเป็นจ่ายแล้ว แอดมินจะตรวจสอบรายการนี้อีกครั้ง",
    });
  } catch (error) {
    console.error("LIFF payment request failed", error);
    const message = error instanceof Error ? error.message : "ตรวจสลิปไม่สำเร็จ";
    return json({ error: message }, message.includes("LINE login") ? 401 : 500);
  }
}

async function handleLiveQueueRequest(payload: any) {
  const configuredClubId = Deno.env.get("LINE_CLUB_ID");
  if (!configuredClubId) return json({ error: "LINE_CLUB_ID is not configured" }, 503);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const clubId = await resolveLiffClubId(admin, payload, configuredClubId);
    let eventQuery = admin.from("events")
      .select("id, event_date, venue, status, starts_at, ends_at")
      .eq("club_id", clubId)
      .eq("status", "open");
    if (payload?.eventId) eventQuery = eventQuery.eq("id", String(payload.eventId));
    else eventQuery = eventQuery.order("event_date", { ascending: false }).order("created_at", { ascending: false });
    const { data: event, error: eventError } = await eventQuery.limit(1).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return json({ error: "ตอนนี้ยังไม่มีรอบที่กำลังเล่น" }, 404);

    const [courtsResult, membersResult, signupsResult, queuePlayersResult, matchesResult] = await Promise.all([
      admin.from("event_courts").select("id, court_name, starts_at, ends_at, position").eq("event_id", event.id).order("position"),
      admin.from("club_members").select("id, nickname, skill_level, playable_skill_levels").eq("club_id", clubId).eq("role", "member").eq("active", true),
      admin.from("signups").select("member_id, status, skill_level_snapshot, playable_skill_levels_snapshot").eq("event_id", event.id).eq("status", "coming"),
      admin.from("event_queue_players").select("member_id, status").eq("event_id", event.id),
      admin.from("queue_matches").select("id, court_id, status, queue_position, started_at").eq("event_id", event.id).in("status", ["approved", "playing"]).order("queue_position"),
    ]);
    for (const result of [courtsResult, membersResult, signupsResult, queuePlayersResult, matchesResult]) if (result.error) throw result.error;
    const matchIds = (matchesResult.data || []).map((match: any) => match.id);
    const { data: matchPlayers, error: matchPlayersError } = matchIds.length
      ? await admin.from("queue_match_players").select("match_id, member_id, team, position, skill_level_snapshot").in("match_id", matchIds)
      : { data: [], error: null };
    if (matchPlayersError) throw matchPlayersError;
    const membersById = new Map((membersResult.data || []).map((member: any) => [member.id, member]));
    const signupsById = new Map((signupsResult.data || []).map((signup: any) => [signup.member_id, signup]));
    const safePlayer = (memberId: string, skillSnapshot?: string | null) => {
      const member: any = membersById.get(memberId);
      return { nickname: String(member?.nickname || "สมาชิก").slice(0, 40), skillLevel: skillSnapshot || (signupsById.get(memberId) as any)?.skill_level_snapshot || member?.skill_level || "-" };
    };
    const playersByMatch = new Map<string, any[]>();
    for (const player of matchPlayers || []) {
      const rows = playersByMatch.get(player.match_id) || [];
      rows.push({ ...safePlayer(player.member_id, player.skill_level_snapshot), team: player.team, slot: `${player.team}${player.position}` });
      playersByMatch.set(player.match_id, rows);
    }
    const playingByCourt = new Map((matchesResult.data || []).filter((match: any) => match.status === "playing").map((match: any) => [match.court_id, match]));
    const courts = [...(courtsResult.data || [])].sort(compareCourtNames).map((court: any) => {
      const match: any = playingByCourt.get(court.id);
      return { id: court.id, name: court.court_name, playing: Boolean(match), startedAt: match?.started_at || null, players: match ? (playersByMatch.get(match.id) || []) : [] };
    });
    const upcoming = (matchesResult.data || []).filter((match: any) => match.status === "approved").sort((a: any, b: any) => a.queue_position - b.queue_position).map((match: any) => ({ id: match.id, position: match.queue_position, players: playersByMatch.get(match.id) || [] }));
    const waitingRows = (queuePlayersResult.data || []).filter((row: any) => row.status === "waiting");
    const levels = ["Rookie-", "Rookie", "BG", "N", "S", "P"];
    const waiting = levels.map((skillLevel) => {
      const players = waitingRows.map((row: any) => ({ memberId: row.member_id, ...safePlayer(row.member_id) })).filter((player: any) => player.skillLevel === skillLevel).map(({ memberId: _memberId, ...player }: any) => player);
      return { skillLevel, count: players.length, players };
    });
    let profile = null;
    if (payload?.idToken) {
      const identity = await verifyLiffIdToken(payload.idToken);
      const { data: linkedMember } = await admin.from("club_members").select("id, nickname, skill_level, playable_skill_levels").eq("club_id", clubId).eq("line_user_id", identity.sub).eq("active", true).eq("role", "member").maybeSingle();
      profile = { memberId: linkedMember?.id || null, nickname: linkedMember?.nickname || "", skillLevel: linkedMember?.skill_level || "", playableSkillLevels: linkedMember?.playable_skill_levels || [] };
    }
    return json({ serverNow: new Date().toISOString(), event: { id: event.id, date: event.event_date, venue: event.venue, startTime: shortTime(event.starts_at), endTime: shortTime(event.ends_at) }, courts, upcoming, waiting, profile });
  } catch (error) {
    console.error("Live queue request failed", error);
    const message = error instanceof Error ? error.message : "โหลดสนามสดไม่สำเร็จ";
    return json({ error: message }, message.includes("LINE login") ? 401 : 500);
  }
}

async function handleLiffRequest(payload: any) {
  const configuredClubId = Deno.env.get("LINE_CLUB_ID");
  if (!configuredClubId) return json({ error: "LINE_CLUB_ID is not configured" }, 503);
  if ((!payload?.eventId && !payload?.latest) || !payload?.idToken) {
    return json({ error: "ข้อมูลสำหรับลงชื่อไม่ครบ" }, 400);
  }

  try {
    const identity = await verifyLiffIdToken(payload.idToken);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const clubId = await resolveLiffClubId(admin, payload, configuredClubId);

    let eventQuery = admin.from("events")
      .select("id, club_id, event_date, venue, status, starts_at, ends_at, clubs!inner(name), event_courts(court_name, starts_at, ends_at, position)")
      .eq("club_id", clubId);
    if (payload.latest) {
      eventQuery = eventQuery
        .eq("status", "open")
        .order("event_date", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      eventQuery = eventQuery.eq("id", payload.eventId);
    }
    const { data: event, error: eventError } = await eventQuery.limit(1).maybeSingle();
    if (eventError) throw eventError;
    if (!event) {
      return json({ error: payload.latest ? "ตอนนี้ยังไม่มีรอบที่เปิดให้ลงชื่อ" : "ไม่พบรอบที่ต้องการลงชื่อ" }, 404);
    }

    const { data: existingMember } = await admin.from("club_members")
      .select("id, display_name, nickname, aliases, skill_level, playable_skill_levels, allow_lower_level, allow_higher_level")
      .eq("club_id", clubId)
      .eq("line_user_id", identity.sub)
      .maybeSingle();

    const { data: existingSignup } = existingMember
      ? await admin.from("signups")
        .select("status, arrival_time, skill_level_snapshot, playable_skill_levels_snapshot, allow_lower_level_snapshot, allow_higher_level_snapshot")
        .eq("event_id", event.id)
        .eq("member_id", existingMember.id)
        .maybeSingle()
      : { data: null };

    if (payload.action === "get_liff_event") {
      return json({
        event: eventForLiff(event),
        profile: {
          name: String(identity.name || existingMember?.display_name || "สมาชิก LINE").slice(0, 80),
          nickname: existingMember?.nickname || "",
          skillLevel: existingMember?.skill_level || "",
          playableSkillLevels: existingMember?.playable_skill_levels || [],
          allowLowerLevel: Boolean(existingMember?.allow_lower_level),
          allowHigherLevel: Boolean(existingMember?.allow_higher_level),
          picture: identity.picture || null,
        },
        currentStatus: existingSignup?.status === "coming" ? "coming" : null,
        currentArrivalTime: existingSignup?.status === "coming" ? shortTime(existingSignup?.arrival_time) : null,
        roster: await getLiffRoster(admin, event),
        queue: existingMember?.id ? await getLiffQueueStatus(admin, event.id, existingMember.id) : null,
      });
    }

    if (payload.action === "cancel_liff_signup") {
      if (existingMember?.id) {
        if (hasBadmintonStarted(event)) {
          return json({ error: "ถึงเวลาเริ่มตีแบดแล้ว กรุณาแจ้งแอดมินให้ยกเลิก" }, 409);
        }
        const chargesResult = await admin.from("member_extra_charges")
          .select("id", { count: "exact", head: true })
          .eq("event_id", event.id)
          .eq("member_id", existingMember.id);
        if (chargesResult.error) throw chargesResult.error;
        if ((chargesResult.count || 0) > 0) {
          return json({ error: "มีรายการน้ำ/ขนมแล้ว กรุณาแจ้งแอดมินให้ยกเลิก" }, 409);
        }
        const { error: deleteError } = await admin.from("signups")
          .delete()
          .eq("event_id", event.id)
          .eq("member_id", existingMember.id);
        if (deleteError) throw deleteError;
        await admin.from("audit_logs").insert({
          club_id: clubId,
          event_id: event.id,
          actor_id: null,
          action: `${existingMember.nickname || existingMember.display_name || "สมาชิก"} ยกเลิกการลงชื่อ`,
          details: { line_user_id: identity.sub, source: "liff" },
        });
      }
      return json({ ok: true, roster: await getLiffRoster(admin, event) });
    }

    if (payload.action === "submit_liff_guest") {
      if (event.status !== "open") return json({ error: "รอบนี้ปิดรับคำตอบแล้ว" }, 409);
      if (!existingMember?.id) return json({ error: "กรุณาตั้งชื่อเล่นของคุณก่อนเพิ่มผู้เล่น" }, 409);

      const guestName = String(payload.guestName || "").trim().replace(/\s+/g, " ");
      if (guestName.length < 1 || guestName.length > 40) {
        return json({ error: "กรุณากรอกชื่อผู้เล่นไม่เกิน 40 ตัวอักษร" }, 400);
      }
      const submitterName = String(existingMember.nickname || existingMember.display_name || "").trim();
      if (normalizeMemberName(guestName) === normalizeMemberName(submitterName)) {
        return json({ error: "ชื่อนี้เป็นชื่อของคุณ กรุณาลงเวลาจากช่องด้านบน" }, 409);
      }

      const arrivalTime = shortTime(payload.arrivalTime);
      const arrivalTimes = buildArrivalTimeOptions(event.starts_at, event.ends_at);
      if (!arrivalTime || !arrivalTimes.includes(arrivalTime)) {
        return json({ error: "กรุณาเลือกเวลาที่จะไปจากตัวเลือกที่กำหนด" }, 400);
      }

      const guestSkill = validateSkillProfile(payload);
      const guestMemberId = await findOrCreateGuestMember(admin, clubId, guestName, guestSkill);
      const submitterLineName = String(identity.name || existingMember.display_name || submitterName || "สมาชิก LINE").slice(0, 80);
      const { error: signupError } = await admin.from("signups").upsert({
        club_id: clubId,
        event_id: event.id,
        member_id: guestMemberId,
        status: "coming",
        arrival_time: arrivalTime,
        submitted_by_line_user_id: identity.sub,
        submitted_by_line_name: submitterLineName,
        skill_level_snapshot: guestSkill.skillLevel,
        playable_skill_levels_snapshot: guestSkill.playableSkillLevels,
        allow_lower_level_snapshot: guestSkill.allowLowerLevel,
        allow_higher_level_snapshot: guestSkill.allowHigherLevel,
      }, { onConflict: "event_id,member_id" });
      if (signupError) throw signupError;

      await admin.from("audit_logs").insert({
        club_id: clubId,
        event_id: event.id,
        actor_id: null,
        action: `${submitterName || "สมาชิก"} เพิ่ม ${guestName} เวลา ${arrivalTime}`,
        details: {
          line_user_id: identity.sub,
          line_display_name: submitterLineName,
          guest_member_id: guestMemberId,
          arrival_time: arrivalTime,
          source: "liff_guest",
        },
      });
      return json({
        ok: true,
        guestName,
        arrivalTime,
        roster: await getLiffRoster(admin, event),
      });
    }

    const nickname = String(payload.nickname || "").trim();
    if (nickname.length < 1 || nickname.length > 40) {
      return json({ error: "กรุณากรอกชื่อเล่นไม่เกิน 40 ตัวอักษร" }, 400);
    }
    const displayName = String(identity.name || existingMember?.display_name || "สมาชิก LINE").slice(0, 80);

    if (["save_liff_nickname", "save_liff_profile", "save_live_profile"].includes(payload.action)) {
      const skill = payload.action !== "save_liff_nickname" ? validateSkillProfile(payload) : {
        skillLevel: existingMember?.skill_level || null,
        playableSkillLevels: existingMember?.playable_skill_levels || [],
        allowLowerLevel: Boolean(existingMember?.allow_lower_level),
        allowHigherLevel: Boolean(existingMember?.allow_higher_level),
      };
      const memberId = await upsertLiffMember(admin, clubId, identity.sub, displayName, nickname, existingMember, skill);
      const { data: queuePlayer } = await admin.from("event_queue_players")
        .select("status")
        .eq("event_id", event.id)
        .eq("member_id", memberId)
        .maybeSingle();
      const snapshotCanChange = !queuePlayer || ["waiting", "left"].includes(queuePlayer.status);
      if (existingSignup?.status === "coming" && skill.skillLevel && snapshotCanChange) {
        const { error: snapshotError } = await admin.from("signups").update({
          skill_level_snapshot: skill.skillLevel,
          playable_skill_levels_snapshot: skill.playableSkillLevels,
          allow_lower_level_snapshot: skill.allowLowerLevel,
          allow_higher_level_snapshot: skill.allowHigherLevel,
        }).eq("event_id", event.id).eq("member_id", memberId);
        if (snapshotError) throw snapshotError;
      }
      return json({ ok: true, nickname, ...skill, appliesAfterCurrentQueue: Boolean(queuePlayer && ["reserved", "playing"].includes(queuePlayer.status)) });
    }

    const status = String(payload.status || "");
    if (status !== "coming") {
      return json({ error: "คำตอบไม่ถูกต้อง" }, 400);
    }
    if (event.status !== "open") return json({ error: "รอบนี้ปิดรับคำตอบแล้ว" }, 409);

    const arrivalTime = shortTime(payload.arrivalTime);
    const arrivalTimes = buildArrivalTimeOptions(event.starts_at, event.ends_at);
    if (!arrivalTime || !arrivalTimes.includes(arrivalTime)) {
      return json({ error: "กรุณาเลือกเวลาที่จะไปจากตัวเลือกที่กำหนด" }, 400);
    }

    const skill = validateSkillProfile(payload);
    const memberId = await upsertLiffMember(admin, clubId, identity.sub, displayName, nickname, existingMember, skill);
    const { error: signupError } = await admin.from("signups").upsert({
      club_id: clubId,
      event_id: event.id,
      member_id: memberId,
      status,
      arrival_time: arrivalTime,
      submitted_by_line_user_id: null,
      submitted_by_line_name: null,
      skill_level_snapshot: skill.skillLevel,
      playable_skill_levels_snapshot: skill.playableSkillLevels,
      allow_lower_level_snapshot: skill.allowLowerLevel,
      allow_higher_level_snapshot: skill.allowHigherLevel,
    }, { onConflict: "event_id,member_id" });
    if (signupError) throw signupError;

    await admin.from("audit_logs").insert({
      club_id: clubId,
      event_id: event.id,
      actor_id: null,
      action: `${nickname} ตอบ ${signupLabel(status)}${arrivalTime ? ` เวลา ${arrivalTime}` : ""}`,
      details: { line_user_id: identity.sub, line_display_name: displayName, arrival_time: arrivalTime, source: "liff" },
    });
    return json({ ok: true, status, arrivalTime, roster: await getLiffRoster(admin, event) });
  } catch (error) {
    console.error("LIFF request failed", error);
    const message = error instanceof Error ? error.message : "ยืนยันบัญชี LINE ไม่สำเร็จ";
    const status = message.includes("LINE login") ? 401 : 500;
    return json({ error: message }, status);
  }
}

async function resolveLiffClubId(admin: any, payload: any, configuredClubId: string) {
  if (!payload?.testMode) return configuredClubId;
  const testClubId = String(payload.testClubId || "");
  if (!testClubId) throw new Error("ไม่พบกลุ่มทดลองสำหรับลิงก์นี้");
  const { data: club, error } = await admin.from("clubs")
    .select("id, is_test")
    .eq("id", testClubId)
    .maybeSingle();
  if (error) throw error;
  if (!club?.is_test) throw new Error("ลิงก์นี้ไม่ได้เชื่อมกับกลุ่มทดลอง");
  return club.id;
}

async function findOrCreateGuestMember(admin: any, clubId: string, guestName: string, skill: any) {
  const { data: guestMembers, error: guestError } = await admin.from("club_members")
    .select("id, nickname, display_name, aliases, line_user_id, skill_level")
    .eq("club_id", clubId)
    .eq("active", true)
    .eq("role", "member");
  if (guestError) throw guestError;

  const normalizedGuestName = normalizeMemberName(guestName);
  const exactMatches = (guestMembers || []).filter((member: any) =>
    [member.nickname, member.display_name, ...(member.aliases || [])]
      .some((value) => normalizeMemberName(value) === normalizedGuestName)
  );
  if (exactMatches.length === 1) {
    const { error: updateError } = await admin.from("club_members").update({
      skill_level: skill.skillLevel,
      playable_skill_levels: skill.playableSkillLevels,
      allow_lower_level: skill.allowLowerLevel,
      allow_higher_level: skill.allowHigherLevel,
    }).eq("id", exactMatches[0].id);
    if (updateError) throw updateError;
    return exactMatches[0].id;
  }

  const { data: newGuest, error: insertError } = await admin.from("club_members").insert({
    club_id: clubId,
    display_name: guestName,
    nickname: guestName,
    line_user_id: null,
    role: "member",
    active: true,
    skill_level: skill.skillLevel,
    playable_skill_levels: skill.playableSkillLevels,
    allow_lower_level: skill.allowLowerLevel,
    allow_higher_level: skill.allowHigherLevel,
  }).select("id").single();
  if (insertError) throw insertError;
  return newGuest.id;
}

function normalizeMemberName(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("th-TH")
    .replace(/[\s._\-®©™]+/g, "");
}

async function upsertLiffMember(
  admin: any,
  clubId: string,
  lineUserId: string,
  displayName: string,
  nickname: string,
  existingMember: any,
  skill: any = null,
) {
  if (!existingMember?.id) {
    const { data: candidates, error: candidateError } = await admin.from("club_members")
      .select("id, display_name, nickname, aliases")
      .eq("club_id", clubId)
      .eq("active", true)
      .eq("role", "member")
      .is("line_user_id", null);
    if (candidateError) throw candidateError;
    const identityKeys = new Set([normalizeMemberName(displayName), normalizeMemberName(nickname)].filter(Boolean));
    const exactMatches = (candidates || []).filter((member: any) =>
      [member.nickname, member.display_name, ...(member.aliases || [])]
        .some((value) => identityKeys.has(normalizeMemberName(value)))
    );
    if (exactMatches.length === 1) {
      const matched = exactMatches[0];
      const aliases = [...new Set([
        ...(matched.aliases || []),
        matched.nickname,
        matched.display_name,
      ].map((value) => String(value || "").trim()).filter(Boolean))];
      const { error } = await admin.from("club_members")
        .update({ display_name: displayName, nickname, line_user_id: lineUserId, aliases, ...(skill?.skillLevel ? { skill_level: skill.skillLevel, playable_skill_levels: skill.playableSkillLevels, allow_lower_level: skill.allowLowerLevel, allow_higher_level: skill.allowHigherLevel } : {}) })
        .eq("id", matched.id);
      if (error) throw error;
      return matched.id;
    }

    const { data: newMember, error } = await admin.from("club_members").insert({
      club_id: clubId,
      display_name: displayName,
      nickname,
      line_user_id: lineUserId,
      role: "member",
      ...(skill?.skillLevel ? { skill_level: skill.skillLevel, playable_skill_levels: skill.playableSkillLevels, allow_lower_level: skill.allowLowerLevel, allow_higher_level: skill.allowHigherLevel } : {}),
    }).select("id").single();
    if (error) throw error;
    return newMember.id;
  }

  if (existingMember.display_name !== displayName || existingMember.nickname !== nickname || skill?.skillLevel) {
    const aliases = [...new Set([
      ...(existingMember.aliases || []),
      existingMember.nickname,
      existingMember.display_name,
    ].map((value) => String(value || "").trim()).filter(Boolean))];
    const { error } = await admin.from("club_members")
      .update({ display_name: displayName, nickname, aliases, ...(skill?.skillLevel ? { skill_level: skill.skillLevel, playable_skill_levels: skill.playableSkillLevels, allow_lower_level: skill.allowLowerLevel, allow_higher_level: skill.allowHigherLevel } : {}) })
      .eq("id", existingMember.id);
    if (error) throw error;
  }
  return existingMember.id;
}

async function getLiffRoster(admin: any, event: any) {
  const { data: signups, error: signupError } = await admin.from("signups")
    .select("member_id, status, arrival_time, skill_level_snapshot, created_at")
    .eq("event_id", event.id)
    .eq("status", "coming")
    .order("created_at");
  if (signupError) throw signupError;
  const memberIds = [...new Set((signups || []).map((row: any) => row.member_id))];
  if (!memberIds.length) return { coming: [] };

  const { data: members, error: memberError } = await admin.from("club_members")
    .select("id, nickname, display_name")
    .in("id", memberIds);
  if (memberError) throw memberError;
  const names = new Map<string, string>((members || []).map((member: any) => [
    member.id,
    String(member.nickname || member.display_name || "สมาชิก").slice(0, 40),
  ]));
  const coming = (signups || []).reduce((rows: Array<{ name: string; arrivalTime: string | null; skillLevel: string | null }>, signup: any) => {
    const name = names.get(signup.member_id);
    if (name) rows.push({ name, arrivalTime: shortTime(signup.arrival_time), skillLevel: signup.skill_level_snapshot || null });
    return rows;
  }, [] as Array<{ name: string; arrivalTime: string | null }>);
  return { coming };
}

function validateSkillProfile(payload: any) {
  const levels = ["Rookie-", "Rookie", "BG", "N", "S", "P"];
  const skillLevel = String(payload.skillLevel || "");
  const index = levels.indexOf(skillLevel);
  if (index < 0) throw new Error("กรุณาเลือกระดับมือ");
  let requestedLevels: string[];
  if (Array.isArray(payload.playableSkillLevels)) {
    requestedLevels = payload.playableSkillLevels.map(String);
    if (new Set(requestedLevels).size !== requestedLevels.length || requestedLevels.some((level) => !levels.includes(level))) {
      throw new Error("ระดับที่สามารถเล่นด้วยได้ไม่ถูกต้อง");
    }
  } else {
    requestedLevels = [skillLevel];
    if (index > 0 && Boolean(payload.allowLowerLevel)) requestedLevels.push(levels[index - 1]);
    if (index < levels.length - 1 && Boolean(payload.allowHigherLevel)) requestedLevels.push(levels[index + 1]);
  }
  if (!requestedLevels.includes(skillLevel)) throw new Error("ต้องเลือกระดับมือของตัวเองไว้เสมอ");
  const playableSkillLevels = levels.filter((level) => requestedLevels.includes(level));
  return {
    skillLevel,
    playableSkillLevels,
    allowLowerLevel: index > 0 && playableSkillLevels.includes(levels[index - 1]),
    allowHigherLevel: index < levels.length - 1 && playableSkillLevels.includes(levels[index + 1]),
  };
}

async function getLiffQueueStatus(admin: any, eventId: string, memberId: string) {
  const { data: queuePlayer, error } = await admin.from("event_queue_players")
    .select("status")
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (!queuePlayer) return null;
  const { data: activeMatches, error: matchError } = await admin.from("queue_matches")
    .select("id, court_id, status")
    .eq("event_id", eventId)
    .in("status", ["draft", "approved", "playing"]);
  if (matchError) throw matchError;
  const matchIds = (activeMatches || []).map((match: any) => match.id);
  const { data: matchPlayer, error: playerError } = matchIds.length
    ? await admin.from("queue_match_players").select("match_id, team").eq("member_id", memberId).in("match_id", matchIds).maybeSingle()
    : { data: null, error: null };
  if (playerError) throw playerError;
  const match = matchPlayer ? (activeMatches || []).find((entry: any) => entry.id === matchPlayer.match_id) : null;
  const { data: court, error: courtError } = match?.status === "playing" && match.court_id
    ? await admin.from("event_courts").select("court_name").eq("id", match.court_id).maybeSingle()
    : { data: null, error: null };
  if (courtError) throw courtError;
  return {
    status: queuePlayer.status,
    team: matchPlayer?.team || null,
    courtName: match?.status === "playing" ? court?.court_name || null : null,
  };
}

async function verifyLiffIdToken(idToken: string) {
  const channelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID");
  if (!channelId) throw new Error("LINE login is not configured");
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  const identity = await response.json();
  if (!response.ok || !identity?.sub) throw new Error("LINE login token is invalid");
  return identity;
}

function eventForLiff(event: any) {
  const club = Array.isArray(event.clubs) ? event.clubs[0] : event.clubs;
  const courts = [...(event.event_courts || [])]
    .sort(compareCourtNames)
    .map((court) => ({
      name: court.court_name,
      time: `${time(court.starts_at)}–${displayEndTime(court.ends_at)}`,
    }));
  return {
    id: event.id,
    clubName: club?.name || "Headshot Badminton",
    dateLabel: thaiLongDate(event.event_date),
    venue: event.venue,
    status: event.status,
    startTime: shortTime(event.starts_at),
    endTime: shortTime(event.ends_at),
    courts,
    arrivalTimes: buildArrivalTimeOptions(event.starts_at, event.ends_at),
  };
}

function hasBadmintonStarted(event: any, now = new Date()) {
  const startTime = shortTime(event?.starts_at);
  if (!event?.event_date || !startTime) return false;
  const startsAt = new Date(`${event.event_date}T${startTime}:00+07:00`);
  return !Number.isNaN(startsAt.getTime()) && now.getTime() >= startsAt.getTime();
}

function buildArrivalTimeOptions(startValue: unknown, endValue: unknown) {
  const start = timeMinutes(startValue);
  let end = timeMinutes(endValue);
  if (start === null || end === null) return [];
  if (end <= start) end += 24 * 60;
  const options = [];
  for (let minute = start; minute < end; minute += 15) {
    options.push(formatMinutes(minute));
  }
  return options;
}

function timeMinutes(value: unknown) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutes(value: number) {
  const minute = value % (24 * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function shortTime(value: unknown) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

async function getLineDisplayName(source: any, token: string) {
  const path = source.groupId
    ? `/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(source.userId)}`
    : `/v2/bot/profile/${encodeURIComponent(source.userId)}`;
  const response = await fetch(`https://api.line.me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return "สมาชิก LINE";
  const profile = await response.json();
  return String(profile.displayName || "สมาชิก LINE").slice(0, 80);
}

async function replyLine(replyToken: string, text: string, token: string) {
  return replyLineMessages(replyToken, [{ type: "text", text }], token);
}

async function replyLineMessages(replyToken: string, messages: any[], token: string) {
  if (!replyToken) return;
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!response.ok) throw new Error(`LINE reply failed (${response.status})`);
}

async function verifyLineSignature(body: string, signature: string, secret: string) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
  if (digest.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < digest.length; index += 1) difference |= digest[index] ^ expected[index];
  return difference === 0;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isoDateValue(value: unknown) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T12:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function bangkokIsoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function extractSlipReference(value: unknown) {
  const source = String(value || "").normalize("NFKC");
  const marker = /(?:เลขที่(?:รายการ|อ้างอิง)|รหัสอ้างอิง|หมายเลขอ้างอิง|transaction\s*(?:id|no\.?|number)|reference\s*(?:id|no\.?|number)?|ref(?:erence)?\.?)/ig;
  let match;
  while ((match = marker.exec(source))) {
    const nearby = source.slice(match.index + match[0].length, match.index + match[0].length + 90);
    const candidate = /[:#\-\s]*([A-Z0-9][A-Z0-9\-]{5,49})/i.exec(nearby)?.[1];
    const normalized = normalizeSlipReference(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeSlipReference(value: unknown) {
  const normalized = String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 6 && normalized.length <= 50 ? normalized : null;
}

function classifySlipRecipient(value: unknown) {
  const source = String(value || "").normalize("NFKC");
  const normalized = normalizeRecipientText(source);
  if (normalized.includes("ณฐกฤตอินนะใจ")) return "match";

  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const recipientMarker = /(บัญชีผู้รับ|ผู้รับ|ไปยัง|recipient|receiver|transfer(?:red)?\s+to)/i;
  for (let index = 0; index < lines.length; index += 1) {
    if (!recipientMarker.test(lines[index])) continue;
    const context = lines.slice(index, index + 3).join(" ").replace(recipientMarker, " ");
    const normalizedContext = normalizeRecipientText(context);
    if (normalizedContext.includes("ณฐกฤตอินนะใจ")) return "match";
    if (normalizedContext.includes("ณฐกฤต") || normalizedContext.includes("อินนะใจ")) return "unclear";
    if (/(นาย|นางสาว|นาง|น\.?\s*ส\.?|คุณ|บริษัท|ห้างหุ้นส่วน)/i.test(context)
      && (context.match(/[ก-๙]/g) || []).length >= 7) {
      return "mismatch";
    }
  }
  return "unclear";
}

function normalizeRecipientText(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^ก-๙a-z0-9]/g, "");
}

function decodeDataUrl(value: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  try {
    return {
      mimeType: match[1],
      bytes: Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)),
    };
  } catch {
    return null;
  }
}

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return null; }
}

function thaiLongDate(isoDate: string) {
  return new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${isoDate}T12:00:00+07:00`));
}

function time(value: string) {
  return value.slice(0, 5).replace(":", ".");
}

function displayEndTime(value: string) {
  const short = value.slice(0, 5);
  return short === "00:00" ? "24.00" : short.replace(":", ".");
}

function signupLabel(status: string) {
  return ({ coming: "ไป", not_coming: "ไม่ไป" } as Record<string, string>)[status] || status;
}
