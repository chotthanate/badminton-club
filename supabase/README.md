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
- `signups` and `attendance`: member responses and actual attendance
- `expenses` and `payments`: event costs and payment records
- `audit_logs`: security-relevant activity history

Creating a club automatically creates an active admin membership for its owner.
Members can update their own signup. A member records only their own departure
through the `mark_self_left_at` database function, which calculates the weight
server-side. Club admins can manage events, members, expenses, payments, and all
attendance rows.
