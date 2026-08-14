alter table public.clubs
add column if not exists line_payment_include_summary boolean not null default true;

comment on column public.clubs.line_payment_include_summary is
  'When true the LINE payment command sends the finalized player totals before the payment card.';
