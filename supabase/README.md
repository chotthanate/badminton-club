# Supabase setup

The first migration defines the shared data model and Row Level Security rules.

## Apply with the Supabase CLI

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Do not put the service-role key in this frontend. The browser should use only the
publishable key; authenticated requests are restricted by the policies in the
migration.

## Tables

- `profiles`: application profile linked to `auth.users`
- `clubs` and `club_members`: club membership and admin roles
- `events`: badminton sessions
- `event_courts`: courts and independent booking times for each session
- `signups` and `attendance`: confirmed/not-coming responses, planned arrival times, and actual attendance
- `club_venues`: remembered venue choices for the next round
- `extra_item_catalog`: reusable counter items such as water and sports drinks
- `member_extra_charges`: drinks or other personal charges added to each player
- `expenses` and `payments`: event costs and payment records
- `audit_logs`: security-relevant activity history

Creating a club automatically creates an active admin membership for its owner.
Members can update their own signup. A member records only their own departure
through the `mark_self_left_at` database function, which calculates the weight
server-side. Club admins can manage events, members, expenses, payments, and all
attendance rows.

## LINE Messaging API setup

Webhook URL for this project:

```text
https://biwnmiedcfmfwuciybus.supabase.co/functions/v1/line-bot
```

1. Create or select a LINE Official Account and enable Messaging API.
2. In LINE Developers, open the channel's **Messaging API** tab:
   - enable **Use webhook**
   - enable **Allow bot to join group chats**
   - set the webhook URL above, then press **Verify**
   - issue a channel access token
3. Copy the **Channel secret** from the Basic settings tab.
4. Store both values only in Supabase Edge Function secrets:

```sh
supabase secrets set \
  LINE_CHANNEL_SECRET=YOUR_CHANNEL_SECRET \
  LINE_CHANNEL_ACCESS_TOKEN=YOUR_CHANNEL_ACCESS_TOKEN \
  --project-ref biwnmiedcfmfwuciybus
```

Never put either LINE secret in `.env.production` or frontend source code.

5. Invite the Official Account into the badminton LINE group and send one
   message in the group. The webhook records the group ID automatically.
6. Press **เปิดลงชื่อ** in the admin website. The function posts a compact Flex
   Message with a **ลงชื่อ** button that opens the LIFF signup screen.
7. Members confirm a nickname, choose **ไป**, **อาจจะไป**, or **ไม่ไป**, and can
   see the confirmed-player roster with each player's planned arrival time. Each response is verified
   with a LINE ID token, linked to the member's LINE user ID, and saved in
   `signups`. The open admin dashboard refreshes every five seconds.

Official references:

- https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- https://developers.line.biz/en/docs/messaging-api/group-chats/
- https://developers.line.biz/en/reference/messaging-api/
