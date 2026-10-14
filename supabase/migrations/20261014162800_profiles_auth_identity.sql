-- Align profiles with permanent application identity linked optionally to
-- Supabase Auth (database_design_v2 / task 1.1).
--
-- Existing profiles.id values are preserved. auth_user_id is backfilled from
-- the previous 1:1 Auth mapping. Role values 'user' become 'employee'.

-- ---------------------------------------------------------------------------
-- Columns and identity relationship
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint profiles_id_fkey;

alter table public.profiles
  alter column id set default gen_random_uuid();

alter table public.profiles
  add column auth_user_id uuid;

alter table public.profiles
  add column updated_by uuid;

-- ---------------------------------------------------------------------------
-- Role and display_name checks (drop before remapping role values)
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint profiles_role_check;

alter table public.profiles
  drop constraint profiles_display_name_check;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where role is distinct from 'user'
  ) then
    raise exception
      'profiles.role contains values other than user; migrate those rows manually before continuing';
  end if;
end $$;

-- Fires profiles_set_updated_at; updated_at changing during migration is accepted.
update public.profiles
set
  auth_user_id = id,
  role = 'employee';

alter table public.profiles
  alter column role set default 'employee';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('employee', 'senior', 'management'));

alter table public.profiles
  add constraint profiles_display_name_check
  check (btrim(display_name) <> '');

alter table public.profiles
  add constraint profiles_auth_user_id_key unique (auth_user_id);

alter table public.profiles
  add constraint profiles_auth_user_id_fkey
  foreign key (auth_user_id)
  references auth.users (id)
  on delete set null;

alter table public.profiles
  add constraint profiles_updated_by_fkey
  foreign key (updated_by)
  references public.profiles (id);

create index profiles_updated_by_idx
  on public.profiles (updated_by);

-- ---------------------------------------------------------------------------
-- Registration: create a permanent profile linked to the new Auth user
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_part text;
  plus_pos integer;
  plus_suffix text;
  resolved_display_name text;
begin
  local_part := split_part(btrim(coalesce(new.email, '')), '@', 1);

  if local_part = '' then
    raise exception
      'Cannot create profile: Auth user % has no usable email local-part',
      new.id;
  end if;

  plus_pos := position('+' in local_part);
  if plus_pos > 0 then
    plus_suffix := substring(local_part from plus_pos + 1);
    if btrim(plus_suffix) <> '' then
      resolved_display_name := plus_suffix;
    else
      resolved_display_name := local_part;
    end if;
  else
    resolved_display_name := local_part;
  end if;

  insert into public.profiles (auth_user_id, display_name)
  values (new.id, resolved_display_name);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymise display_name when the Auth link is cleared
-- ---------------------------------------------------------------------------

create or replace function public.anonymise_unlinked_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auth_user_id is null then
    new.display_name := new.id::text;
  end if;

  return new;
end;
$$;

create trigger profiles_anonymise_unlinked
before insert or update on public.profiles
for each row
execute function public.anonymise_unlinked_profile();

-- ---------------------------------------------------------------------------
-- Own-profile select must match Auth UUID via auth_user_id
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_own" on public.profiles;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = auth_user_id);
