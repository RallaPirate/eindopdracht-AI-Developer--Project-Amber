import { err, ok, type AppResult, SAFE_ERROR_MESSAGES } from "@/lib/appResult";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fieldMessage(fieldLabel: string | undefined, fallback: string): string {
  if (!fieldLabel) {
    return fallback;
  }
  return `${fieldLabel} is invalid.`;
}

/**
 * Runtime check for a non-empty trimmed string.
 * TypeScript types alone are not treated as validation.
 */
export function parseNonEmptyString(
  value: unknown,
  fieldLabel?: string,
): AppResult<string> {
  if (typeof value !== "string") {
    return err(
      "validation",
      fieldMessage(fieldLabel, SAFE_ERROR_MESSAGES.validation),
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(
      "validation",
      fieldMessage(fieldLabel, SAFE_ERROR_MESSAGES.validation),
    );
  }

  return ok(trimmed);
}

/**
 * Optional string: `null`/`undefined`/blank → `null`; otherwise non-empty text.
 */
export function parseOptionalNonEmptyString(
  value: unknown,
  fieldLabel?: string,
): AppResult<string | null> {
  if (value == null) {
    return ok(null);
  }
  if (typeof value !== "string") {
    return err(
      "validation",
      fieldMessage(fieldLabel, SAFE_ERROR_MESSAGES.validation),
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ok(null);
  }
  return ok(trimmed);
}

/**
 * Validates a UUID string used for permanent identifiers (profiles, rows, etc.).
 */
export function parseUuid(
  value: unknown,
  fieldLabel?: string,
): AppResult<string> {
  const parsed = parseNonEmptyString(value, fieldLabel);
  if (!parsed.ok) {
    return parsed;
  }

  if (!UUID_PATTERN.test(parsed.data)) {
    return err(
      "validation",
      fieldMessage(fieldLabel, SAFE_ERROR_MESSAGES.validation),
    );
  }

  return ok(parsed.data);
}

/**
 * Validates membership in a fixed string union without Zod.
 */
export function parseOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldLabel?: string,
): AppResult<T> {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return err(
      "validation",
      fieldMessage(fieldLabel, SAFE_ERROR_MESSAGES.validation),
    );
  }
  return ok(value as T);
}
