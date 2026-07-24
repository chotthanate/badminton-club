alter table public.club_members
add column payment_exempt boolean not null default false;

comment on column public.club_members.payment_exempt is
'Member participates in shared-cost allocation but is treated as settled and omitted from payment collection messages.';
