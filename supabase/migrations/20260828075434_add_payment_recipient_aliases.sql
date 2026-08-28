alter table public.clubs
  add column if not exists payment_recipient_names text[] not null
  default array['ณฐกฤต อินนะใจ', 'NATHAKRIT INN', 'NATHAKRIT INNAJAI']::text[];

alter table public.clubs
  drop constraint if exists clubs_payment_recipient_names_not_empty;

alter table public.clubs
  add constraint clubs_payment_recipient_names_not_empty
  check (cardinality(payment_recipient_names) > 0);
