create policy "clubs_select_owners" on public.clubs
for select to authenticated
using (owner_id = (select auth.uid()));
