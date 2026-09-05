revoke all on function public.operator_remove_event_participant(uuid, uuid) from public;
revoke all on function public.operator_remove_event_participant(uuid, uuid) from anon;
grant execute on function public.operator_remove_event_participant(uuid, uuid) to authenticated;
