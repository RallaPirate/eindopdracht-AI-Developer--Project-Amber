-- 1.11a: RLS security foundation and profiles.
--
-- - Harden privileges on the six application tables (RLS does not protect TRUNCATE).
-- - Add private auth.uid()-based profile/role helpers for later RLS policies.
-- - Complete profiles SELECT: own row for linked users; all rows for Management.
--
-- Profile INSERT remains public.handle_new_user() (SECURITY DEFINER registration
-- trigger). No client INSERT/UPDATE/DELETE policies on profiles.
-- Management role UPDATE is deferred to the controlled workflow in step 8.3.
--
-- Schema private must stay out of the hosted Data API exposed schemas
-- (repository config.toml is not sufficient proof for the live project).

-- ---------------------------------------------------------------------------
-- 1. Table privileges (six application tables only)
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.species_database from anon, authenticated;
revoke all on table public.specimens from anon, authenticated;
revoke all on table public.reports from anon, authenticated;
revoke all on table public.species_knowledge_index from anon, authenticated;
revoke all on table public.species_knowledge_sources from anon, authenticated;

grant select on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Private helpers (auth.uid() → permanent profile id / role)
-- ---------------------------------------------------------------------------

create schema private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles as p
  where p.auth_user_id = (select auth.uid());
$$;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.auth_user_id = (select auth.uid());
$$;

revoke all on function private.current_profile_id() from public, anon, service_role;
revoke all on function private.current_profile_role() from public, anon, service_role;
grant execute on function private.current_profile_id() to authenticated;
grant execute on function private.current_profile_role() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Profiles SELECT: Management may read all personnel rows
-- ---------------------------------------------------------------------------
-- Existing profiles_select_own is preserved (auth.uid() = auth_user_id).

create policy profiles_select_management
on public.profiles
for select
to authenticated
using ((select private.current_profile_role()) = 'management');
