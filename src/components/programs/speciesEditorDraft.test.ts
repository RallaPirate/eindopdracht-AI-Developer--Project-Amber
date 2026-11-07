import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSaveSpeciesEdit,
  parseSpeciesEditDraft,
  speciesEditDraftFrom,
} from "./speciesEditorDraft.ts";
import type { LocalSpecies } from "./speciesDatabaseView.ts";

const species: LocalSpecies = {
  id: "00000000-0000-4000-8000-000000000001",
  display_name: "  Amber Lynx  ",
  general_description: "Lives in the reed beds.",
  diet_preferences: "Fish",
  habitat_preferences: "Reed beds",
  handling_guidance: "Keep two handlers on the near side.",
  minimum_handlers: 2,
  safety_class: "high",
  updated_at: "2026-03-15T14:30:45.123456+00:00",
};

test("a species draft starts from the seven editable fields", () => {
  const draft = speciesEditDraftFrom(species);
  assert.equal(draft.display_name, "  Amber Lynx  ");
  assert.equal(draft.minimum_handlers, "2");
  assert.equal(draft.safety_class, "high");
  assert.equal(canSaveSpeciesEdit(species, draft), false);
  assert.equal(Object.hasOwn(draft, "id"), false);
  assert.equal(Object.hasOwn(draft, "updated_at"), false);
});

test("save stays closed until the draft is valid and different", () => {
  const draft = speciesEditDraftFrom(species);
  const renamed = { ...draft, display_name: "Amber Lynx" };
  const blank = { ...draft, habitat_preferences: "   " };
  const zero = { ...draft, minimum_handlers: "0" };
  const spacedCount = { ...draft, minimum_handlers: "2 " };
  const paddedCount = { ...draft, minimum_handlers: "02" };

  assert.equal(canSaveSpeciesEdit(species, renamed), true);
  assert.equal(parseSpeciesEditDraft(renamed).ok, true);
  assert.equal(canSaveSpeciesEdit(species, blank), false);
  assert.equal(canSaveSpeciesEdit(species, zero), false);
  assert.equal(canSaveSpeciesEdit(species, spacedCount), false);
  assert.equal(canSaveSpeciesEdit(species, paddedCount), false);
  const parsed = parseSpeciesEditDraft(draft);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.data, {
    display_name: species.display_name,
    general_description: species.general_description,
    diet_preferences: species.diet_preferences,
    habitat_preferences: species.habitat_preferences,
    handling_guidance: species.handling_guidance,
    minimum_handlers: 2,
    safety_class: "high",
  });
});
