alter table public.events
  add column if not exists line_publish_ready boolean not null default false;

comment on column public.events.line_publish_ready is
  'Admin has approved this draft to be opened by the next LINE group reply command.';
