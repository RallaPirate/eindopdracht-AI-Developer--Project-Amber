-- 1.11b: RLS permissions and field-level enforcement for species_database
-- and specimens.
--
-- Three layers (locked design §6):
--   1. Narrow grants — SELECT for linked clients; column-level INSERT/UPDATE;
--      no DELETE; no anon privileges; no client privileges on identity/audit columns.
--   2. RLS — linked-profile SELECT; Management INSERT; Senior/Management UPDATE.
--   3. BEFORE INSERT OR UPDATE triggers — role-specific field rules; stamp
--      updated_by from private.current_profile_id() on authorised client writes;
--      reject unlinked/unauthorised client writes.
--
-- lysine_protocol is included in specimens UPDATE grants because Management must
-- edit it; Senior denial is enforced in the specimens write trigger (both app
-- roles share PostgreSQL role authenticated).
--
-- Privileged database sessions (service_role JWT, or current_user with
-- SUPERUSER/BYPASSRLS) are detected explicitly. A missing/null auth.uid() on an
-- ordinary role is rejected — it is not treated as a trusted admin path.
-- Privileged sessions keep identity immutability on UPDATE, do not call the
-- private profile helpers, and do not overwrite updated_by.
--
-- Trigger order (PostgreSQL alphabetical BEFORE triggers on the same event):
--   species_database_enforce_write  then  species_database_set_updated_at
--   specimens_enforce_write         then  specimens_set_updated_at
-- Field triggers assign NEW.updated_by without requiring client UPDATE privilege
-- on that column (privilege checks apply to the statement SET list). Existing
-- set_updated_at triggers continue to maintain updated_at.
--
-- Preserves existing CHECKs, FKs, unique constraints and set_updated_at triggers.
-- Does not change reports, knowledge tables, or profiles policies/helpers.
-- No SECURITY DEFINER write RPCs.

-- ---------------------------------------------------------------------------
-- 1. Privileges
-- ---------------------------------------------------------------------------
-- Table-level SELECT grants read access to all columns.
-- Column-level INSERT/UPDATE do not imply table-wide write: only listed columns
-- may appear in INSERT column lists / UPDATE SET lists for authenticated.
-- Absence of DELETE grant denies DELETE even if an RLS policy were added later.

revoke all on table public.species_database from anon, authenticated;
revoke all on table public.specimens from anon, authenticated;

grant select on table public.species_database to authenticated;
grant select on table public.specimens to authenticated;

grant insert (
  external_species_id,
  display_name,
  general_description,
  diet_preferences,
  habitat_preferences,
  handling_guidance,
  minimum_handlers,
  safety_class
) on table public.species_database to authenticated;

grant update (
  display_name,
  general_description,
  diet_preferences,
  habitat_preferences,
  handling_guidance,
  minimum_handlers,
  safety_class
) on table public.species_database to authenticated;

grant insert (
  species_id,
  asset_code,
  nickname,
  date_of_birth,
  weight_kg,
  length_m,
  height_m,
  speed_kmh,
  lysine_protocol,
  location,
  status
) on table public.specimens to authenticated;

grant update (
  nickname,
  date_of_birth,
  weight_kg,
  length_m,
  height_m,
  speed_kmh,
  lysine_protocol,
  location,
  status
) on table public.specimens to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS policies (explicit INSERT WITH CHECK; UPDATE USING + WITH CHECK)
-- ---------------------------------------------------------------------------

create policy species_database_select_linked
on public.species_database
for select
to authenticated
using ((select private.current_profile_id()) is not null);

create policy species_database_insert_management
on public.species_database
for insert
to authenticated
with check ((select private.current_profile_role()) = 'management');

create policy species_database_update_editors
on public.species_database
for update
to authenticated
using ((select private.current_profile_role()) in ('senior', 'management'))
with check ((select private.current_profile_role()) in ('senior', 'management'));

create policy specimens_select_linked
on public.specimens
for select
to authenticated
using ((select private.current_profile_id()) is not null);

create policy specimens_insert_management
on public.specimens
for insert
to authenticated
with check ((select private.current_profile_role()) = 'management');

create policy specimens_update_editors
on public.specimens
for update
to authenticated
using ((select private.current_profile_role()) in ('senior', 'management'))
with check ((select private.current_profile_role()) in ('senior', 'management'));

-- ---------------------------------------------------------------------------
-- 3. Write-validation triggers
-- ---------------------------------------------------------------------------

create or replace function public.enforce_species_database_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_privileged boolean;
  acting_id uuid;
begin
  is_privileged :=
    coalesce((select auth.role()), '') = 'service_role'
    or exists (
      select 1
      from pg_catalog.pg_roles as r
      where r.rolname = current_user
        and (r.rolsuper or r.rolbypassrls)
    );

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.external_species_id is distinct from old.external_species_id
       or new.created_at is distinct from old.created_at then
      raise exception
        'species_database update rejected: id, external_species_id and created_at are immutable';
    end if;
  end if;

  if is_privileged then
    return new;
  end if;

  -- Ordinary client path: JWT + linked application profile required.
  if (select auth.uid()) is null then
    raise exception
      'species_database write rejected: authenticated session required';
  end if;

  acting_id := (select private.current_profile_id());
  if acting_id is null then
    raise exception
      'species_database write rejected: linked application profile required';
  end if;

  new.updated_by := acting_id;
  return new;
end;
$$;

create or replace function public.enforce_specimens_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_privileged boolean;
  acting_id uuid;
  acting_role text;
begin
  is_privileged :=
    coalesce((select auth.role()), '') = 'service_role'
    or exists (
      select 1
      from pg_catalog.pg_roles as r
      where r.rolname = current_user
        and (r.rolsuper or r.rolbypassrls)
    );

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.species_id is distinct from old.species_id
       or new.asset_code is distinct from old.asset_code
       or new.created_at is distinct from old.created_at then
      raise exception
        'specimens update rejected: id, species_id, asset_code and created_at are immutable';
    end if;
  end if;

  if is_privileged then
    return new;
  end if;

  if (select auth.uid()) is null then
    raise exception
      'specimens write rejected: authenticated session required';
  end if;

  acting_id := (select private.current_profile_id());
  acting_role := (select private.current_profile_role());
  if acting_id is null then
    raise exception
      'specimens write rejected: linked application profile required';
  end if;

  if tg_op = 'UPDATE'
     and new.lysine_protocol is distinct from old.lysine_protocol
     and acting_role is distinct from 'management' then
    raise exception
      'specimens update rejected: lysine_protocol may only be changed by management';
  end if;

  new.updated_by := acting_id;
  return new;
end;
$$;

revoke all on function public.enforce_species_database_write()
  from public, anon, authenticated;
revoke all on function public.enforce_specimens_write()
  from public, anon, authenticated;

create trigger species_database_enforce_write
before insert or update on public.species_database
for each row
execute function public.enforce_species_database_write();

create trigger specimens_enforce_write
before insert or update on public.specimens
for each row
execute function public.enforce_specimens_write();

comment on function public.enforce_species_database_write() is
  'BEFORE INSERT/UPDATE on species_database: privileged vs client session split; immutable identity fields; stamp updated_by for linked client writers.';

comment on function public.enforce_specimens_write() is
  'BEFORE INSERT/UPDATE on specimens: privileged vs client session split; immutable identity fields; Management-only lysine_protocol changes; stamp updated_by for linked client writers.';

comment on trigger species_database_enforce_write on public.species_database is
  'Runs alphabetically before species_database_set_updated_at; stamps updated_by then set_updated_at maintains updated_at.';

comment on trigger specimens_enforce_write on public.specimens is
  'Runs alphabetically before specimens_set_updated_at; stamps updated_by then set_updated_at maintains updated_at.';

-- ---------------------------------------------------------------------------
-- 4. Reviewer verification notes (do not run inside this migration)
-- ---------------------------------------------------------------------------
-- Privilege combination (as role authenticated):
--   select has_table_privilege('authenticated', 'public.species_database', 'SELECT');  -- true
--   select has_table_privilege('authenticated', 'public.species_database', 'DELETE');  -- false
--   select has_column_privilege('authenticated', 'public.species_database', 'display_name', 'UPDATE');           -- true
--   select has_column_privilege('authenticated', 'public.species_database', 'external_species_id', 'UPDATE');    -- false
--   select has_column_privilege('authenticated', 'public.species_database', 'updated_by', 'UPDATE');             -- false
--   select has_column_privilege('authenticated', 'public.species_database', 'updated_at', 'UPDATE');             -- false
--   select has_column_privilege('authenticated', 'public.species_database', 'id', 'INSERT');                  -- false
--   select has_column_privilege('authenticated', 'public.specimens', 'lysine_protocol', 'UPDATE');              -- true (Senior blocked by trigger)
--   select has_column_privilege('authenticated', 'public.specimens', 'species_id', 'UPDATE');                   -- false
--   select has_column_privilege('authenticated', 'public.specimens', 'asset_code', 'UPDATE');                   -- false
--   select has_column_privilege('authenticated', 'public.specimens', 'updated_by', 'UPDATE');                   -- false
--
-- Expected behavioural checks with linked JWTs (step 1.12 / independent review):
--   Employee: SELECT ok; INSERT/UPDATE denied by RLS.
--   Senior: UPDATE permitted specimen fields ok; UPDATE lysine_protocol raises
--           specimens update rejected: lysine_protocol may only be changed by management.
--   Management: UPDATE lysine_protocol ok; INSERT species/specimens ok; updated_by
--               equals private.current_profile_id(); updated_at advanced by set_updated_at.
--   Unlinked authenticated / anon: no SELECT/INSERT/UPDATE.
--   Client SET of id / external_species_id / species_id / asset_code / created_at /
--   updated_by / updated_at: denied by missing column privilege and/or trigger.
