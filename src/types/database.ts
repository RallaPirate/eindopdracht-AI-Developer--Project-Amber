/**
 * Authoritative application roles stored in `public.profiles.role`.
 * Never accept these from the browser, request parameters or Auth metadata.
 */
export const APPLICATION_ROLES = ["employee", "senior", "management"] as const;

export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

export function isApplicationRole(value: unknown): value is ApplicationRole {
  return (
    typeof value === "string" &&
    (APPLICATION_ROLES as readonly string[]).includes(value)
  );
}
