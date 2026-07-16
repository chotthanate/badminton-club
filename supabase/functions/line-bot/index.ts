import { createClient } from "npm:@supabase/supabase-js@2";

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

  if (["get_liff_event", "submit_liff_signup"].includes(payload?.action)) {
    return handleLiffRequest(payload);
  }

  if (authorization) {
    return publishFromAdmin(request, rawBody, authorization);
  }

  return receiveLineWebhook(request, rawBody);
});

async function publishFromAdmin(request: Request, rawBody: string, authorization: string) {
  const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const liffId = Deno.env.get("LINE_LIFF_ID");
  if (!lineToken) return json({ error: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN" }, 503);
  if (!liffId) return json({ error: "ยังไม่ได้ตั้งค่า LINE_LIFF_ID" }, 503);

  const payload = safeJson(rawBody);
  if (payload?.action !== "publish_event" || !payload.eventId) {
    return json({ error: "Invalid action" }, 400);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  const { data: event, error: eventError } = await userClient
    .from("events")
    .select("id, club_id, event_date, venue, status, clubs!inner(name, line_group_id), event_courts(court_name, starts_at, ends_at, position)")
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

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lineToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: club.line_group_id,
      messages: [buildSignupMessage(event, club.name, liffId)],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("LINE push failed", response.status, details);
    return json({ error: "ส่งข้อความเข้า LINE ไม่สำเร็จ" }, 502);
  }

  await userClient.from("events").update({ status: "open" }).eq("id", event.id);
  await userClient.from("audit_logs").insert({
    club_id: event.club_id,
    event_id: event.id,
    actor_id: authData.user.id,
    action: "เปิดลงชื่อและส่งเข้า LINE",
  });
  return json({ ok: true });
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

  for (const event of payload?.events || []) {
    const groupId = event.source?.groupId;
    if (groupId) {
      await admin.from("clubs").update({ line_group_id: groupId }).eq("id", clubId);
    }

    if (event.type !== "postback" || !event.source?.userId) continue;
    const data = new URLSearchParams(event.postback?.data || "");
    if (data.get("action") !== "signup") continue;

    const eventId = data.get("event_id");
    const status = data.get("status");
    if (!eventId || !["coming", "maybe", "not_coming"].includes(status || "")) continue;

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

function buildSignupMessage(event: any, clubName: string, liffId: string) {
  const courts = [...(event.event_courts || [])]
    .sort((a, b) => a.position - b.position)
    .map((court) => `${court.court_name} : ${time(court.starts_at)}-${displayEndTime(court.ends_at)}`)
    .join("\n");
  const title = `${clubName} : วันที่ ${thaiLongDate(event.event_date)}`;

  return {
    type: "flex",
    altText: `${title}\nสถานที่ : ${event.venue}\n${courts}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: clubName, weight: "bold", size: "xl", wrap: true },
          { type: "text", text: `วันที่ ${thaiLongDate(event.event_date)}`, color: "#15966a", weight: "bold" },
          { type: "separator" },
          { type: "text", text: `สถานที่ : ${event.venue}`, wrap: true },
          { type: "text", text: courts || "ยังไม่ได้ระบุคอร์ท", wrap: true },
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
              label: "ลงชื่อ",
              uri: `https://liff.line.me/${liffId}?event_id=${event.id}`,
            },
          },
        ],
      },
    },
  };
}

async function handleLiffRequest(payload: any) {
  const clubId = Deno.env.get("LINE_CLUB_ID");
  if (!clubId) return json({ error: "LINE_CLUB_ID is not configured" }, 503);
  if (!payload?.eventId || !payload?.idToken) return json({ error: "ข้อมูลสำหรับลงชื่อไม่ครบ" }, 400);

  try {
    const identity = await verifyLiffIdToken(payload.idToken);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: event, error: eventError } = await admin.from("events")
      .select("id, club_id, event_date, venue, status, clubs!inner(name), event_courts(court_name, starts_at, ends_at, position)")
      .eq("id", payload.eventId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) return json({ error: "ไม่พบรอบที่ต้องการลงชื่อ" }, 404);

    const { data: existingMember } = await admin.from("club_members")
      .select("id, display_name")
      .eq("club_id", clubId)
      .eq("line_user_id", identity.sub)
      .maybeSingle();

    const { data: existingSignup } = existingMember
      ? await admin.from("signups")
        .select("status")
        .eq("event_id", event.id)
        .eq("member_id", existingMember.id)
        .maybeSingle()
      : { data: null };

    if (payload.action === "get_liff_event") {
      return json({
        event: eventForLiff(event),
        profile: {
          name: String(identity.name || existingMember?.display_name || "สมาชิก LINE").slice(0, 80),
          picture: identity.picture || null,
        },
        currentStatus: existingSignup?.status || null,
      });
    }

    const status = String(payload.status || "");
    if (!["coming", "maybe", "not_coming"].includes(status)) {
      return json({ error: "คำตอบไม่ถูกต้อง" }, 400);
    }
    if (event.status !== "open") return json({ error: "รอบนี้ปิดรับคำตอบแล้ว" }, 409);

    const displayName = String(identity.name || existingMember?.display_name || "สมาชิก LINE").slice(0, 80);
    let memberId = existingMember?.id;
    if (!memberId) {
      const { data: newMember, error } = await admin.from("club_members").insert({
        club_id: clubId,
        display_name: displayName,
        line_user_id: identity.sub,
        role: "member",
      }).select("id").single();
      if (error) throw error;
      memberId = newMember.id;
    } else if (existingMember.display_name !== displayName) {
      await admin.from("club_members").update({ display_name: displayName }).eq("id", memberId);
    }

    const { error: signupError } = await admin.from("signups").upsert({
      club_id: clubId,
      event_id: event.id,
      member_id: memberId,
      status,
    }, { onConflict: "event_id,member_id" });
    if (signupError) throw signupError;

    await admin.from("audit_logs").insert({
      club_id: clubId,
      event_id: event.id,
      actor_id: null,
      action: `${displayName} ตอบ ${signupLabel(status)}`,
      details: { line_user_id: identity.sub, source: "liff" },
    });
    return json({ ok: true, status });
  } catch (error) {
    console.error("LIFF request failed", error);
    const message = error instanceof Error ? error.message : "ยืนยันบัญชี LINE ไม่สำเร็จ";
    const status = message.includes("LINE login") ? 401 : 500;
    return json({ error: message }, status);
  }
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
    .sort((a, b) => a.position - b.position)
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
    courts,
  };
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
  if (!replyToken) return;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
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

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return null; }
}

function thaiLongDate(isoDate: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" })
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
  return ({ coming: "ไป", maybe: "อาจจะไป", not_coming: "ไม่ไป" } as Record<string, string>)[status] || status;
}
