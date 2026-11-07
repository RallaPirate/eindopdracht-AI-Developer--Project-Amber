import type { AppResult } from "../../lib/appResult.ts";
import {
  parseSpeciesEditableFields,
  type LocalSpecies,
  type SafetyClass,
  type SpeciesEditableFields,
} from "./speciesDatabaseView.ts";

/** Text the editor holds before it is checked by the shared species validation. */
export type SpeciesEditDraft = {
  display_name: string;
  general_description: string;
  diet_preferences: string;
  habitat_preferences: string;
  handling_guidance: string;
  minimum_handlers: string;
  safety_class: SafetyClass;
};

const INTEGER_TEXT = /^(?:0|[1-9]\d*)$/;

export function speciesEditDraftFrom(species: LocalSpecies): SpeciesEditDraft {
  return {
    display_name: species.display_name,
    general_description: species.general_description,
    diet_preferences: species.diet_preferences,
    habitat_preferences: species.habitat_preferences,
    handling_guidance: species.handling_guidance,
    minimum_handlers: String(species.minimum_handlers),
    safety_class: species.safety_class,
  };
}

/**
 * Checks a draft with the shared species validation.
 * The handler count is accepted only as a base-10 integer string.
 * Authored text is passed through unchanged.
 */
export function parseSpeciesEditDraft(
  draft: SpeciesEditDraft,
): AppResult<SpeciesEditableFields> {
  const minimumHandlers = INTEGER_TEXT.test(draft.minimum_handlers)
    ? Number(draft.minimum_handlers)
    : Number.NaN;
  return parseSpeciesEditableFields({
    display_name: draft.display_name,
    general_description: draft.general_description,
    diet_preferences: draft.diet_preferences,
    habitat_preferences: draft.habitat_preferences,
    handling_guidance: draft.handling_guidance,
    minimum_handlers: minimumHandlers,
    safety_class: draft.safety_class,
  });
}

export function speciesEditHasChanges(
  baseline: SpeciesEditableFields,
  fields: SpeciesEditableFields,
): boolean {
  return (
    baseline.display_name !== fields.display_name ||
    baseline.general_description !== fields.general_description ||
    baseline.diet_preferences !== fields.diet_preferences ||
    baseline.habitat_preferences !== fields.habitat_preferences ||
    baseline.handling_guidance !== fields.handling_guidance ||
    baseline.minimum_handlers !== fields.minimum_handlers ||
    baseline.safety_class !== fields.safety_class
  );
}

/** Save is allowed only for a valid draft that differs from the opened record. */
export function canSaveSpeciesEdit(
  baseline: SpeciesEditableFields,
  draft: SpeciesEditDraft,
): boolean {
  const parsed = parseSpeciesEditDraft(draft);
  return parsed.ok && speciesEditHasChanges(baseline, parsed.data);
}
