-- Allow authenticated users to read their own profile row.
-- Required for session restoration display_name enrichment.

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);
