-- The caller keeps their JWT and column-level INSERT grants. The only new
-- authority is a server-minted proof for one exact row and permanent profile.
-- Provision the same 32-byte hex key in Vault (species_database_insert_proof_v1)
-- and the app environment (SPECIES_INSERT_PROOF_SECRET), outside migrations.

create function private.verify_species_insert_proof(
  p_external_species_id text,
  p_display_name text,
  p_general_description text,
  p_diet_preferences text,
  p_habitat_preferences text,
  p_handling_guidance text,
  p_minimum_handlers smallint,
  p_safety_class text
)
returns boolean
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  profile_id uuid := private.current_profile_id();
  proof text;
  expires_at bigint;
  now_seconds bigint := floor(extract(epoch from statement_timestamp()));
  secret_hex text;
  secret_key bytea;
  message text;
  expected_mac bytea;
  supplied_mac bytea;
begin
  if profile_id is null then
    return false;
  end if;

  proof := nullif(current_setting('request.headers', true), '')::jsonb
    ->> 'x-amber-species-insert-proof';
  if proof is null or proof collate "C" !~ '^v1\.[0-9]{10}\.[0-9a-f]{64}$' then
    return false;
  end if;

  expires_at := split_part(proof, '.', 2)::bigint;
  -- The app issues 60-second proofs. Allow its clock to lead by up to 5
  -- seconds on the upper bound only, with no grace period after expiry.
  if expires_at <= now_seconds or expires_at > now_seconds + 60 + 5 then
    return false;
  end if;

  select s.decrypted_secret into secret_hex
  from vault.decrypted_secrets as s
  where s.name = 'species_database_insert_proof_v1';
  if secret_hex is null or secret_hex collate "C" !~ '^[0-9a-fA-F]{64}$' then
    return false;
  end if;
  secret_key := decode(secret_hex, 'hex');

  -- Same fixed order and UTF-8 hex encoding as speciesInsertProof.ts.
  message := array_to_string(array[
    'amber:species-enrichment-insert', 'v1', expires_at::text, profile_id::text,
    encode(convert_to(p_external_species_id, 'UTF8'), 'hex'),
    encode(convert_to(p_display_name, 'UTF8'), 'hex'),
    encode(convert_to(p_general_description, 'UTF8'), 'hex'),
    encode(convert_to(p_diet_preferences, 'UTF8'), 'hex'),
    encode(convert_to(p_habitat_preferences, 'UTF8'), 'hex'),
    encode(convert_to(p_handling_guidance, 'UTF8'), 'hex'),
    encode(convert_to(p_minimum_handlers::text, 'UTF8'), 'hex'),
    encode(convert_to(p_safety_class, 'UTF8'), 'hex')
  ], ':');
  expected_mac := extensions.hmac(convert_to(message, 'UTF8'), secret_key, 'sha256');
  supplied_mac := decode(split_part(proof, '.', 3), 'hex');

  -- Blind the comparison so bytea equality does not compare attacker-chosen
  -- bytes directly with the expected MAC.
  return extensions.hmac(expected_mac, secret_key, 'sha256')
    = extensions.hmac(supplied_mac, secret_key, 'sha256');
exception
  when invalid_text_representation then return false;
end;
$$;

revoke all on function private.verify_species_insert_proof(
  text, text, text, text, text, text, smallint, text
) from public, anon, authenticated, service_role;
grant execute on function private.verify_species_insert_proof(
  text, text, text, text, text, text, smallint, text
) to authenticated;

alter policy species_database_insert_management on public.species_database
with check (
  (select private.current_profile_role()) = 'management'
  and private.verify_species_insert_proof(
    external_species_id,
    display_name,
    general_description,
    diet_preferences,
    habitat_preferences,
    handling_guidance,
    minimum_handlers,
    safety_class
  )
);
