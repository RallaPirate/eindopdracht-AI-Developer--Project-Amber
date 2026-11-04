import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";

import {
  API_CONTENT_AUTHORITY,
  assembleSpeciesEnrichmentProposal,
  EXTERNAL_SPECIES_SOURCE_SYSTEM,
  externalSpeciesFactsSchema,
  parseSpeciesEnrichmentRequest,
  speciesEnrichmentModelOutputSchema,
  speciesEnrichmentProposalSchema,
  validateSpeciesEnrichmentModelProposal,
} from "./speciesEnrichmentSchemas.ts";

const RETRIEVED_AT = "2026-11-03T21:04:00.000Z";

function provenance(
  basis: "api_interpretation" | "operational_recommendation",
  supportingFields: string[],
  uncertainty: string | null,
) {
  return {
    basis,
    supporting_fields: supportingFields,
    uncertainty,
  };
}

function completeModel() {
  return {
    general_description: "A large fictional grazer of the amber marsh.",
    diet_preferences: "Browses mineral-rich marsh shrubs.",
    habitat_preferences: "Shallow amber marsh with firm banks.",
    handling_guidance: "Keep two handlers on the bank during feeding.",
    minimum_handlers: 2,
    safety_class: "moderate" as const,
    provenance: {
      general_description: provenance(
        "api_interpretation",
        ["scientific_name", "region"],
        null,
      ),
      diet_preferences: provenance("api_interpretation", ["diet_profile"], null),
      habitat_preferences: provenance(
        "api_interpretation",
        ["region"],
        "Region is known, but enclosure dimensions are not.",
      ),
      handling_guidance: provenance(
        "operational_recommendation",
        ["general_care_recommendations", "social_requirements"],
        null,
      ),
      minimum_handlers: provenance(
        "operational_recommendation",
        ["social_requirements"],
        null,
      ),
      safety_class: provenance(
        "operational_recommendation",
        ["diet_profile", "general_care_recommendations"],
        null,
      ),
    },
  };
}

function sourceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "bramble-back",
    scientific_name: "  Brambleback imaginarius  ",
    diet_profile: "browser",
    geological_period: null as string | null,
    region: "North marsh",
    social_requirements: "pairs",
    general_care_recommendations: "Reference note only. Not an order.",
    hybrid: false,
    franchise_origins: ["fictional-reserve"],
    franchise_appearances: [] as string[],
    ...overrides,
  };
}

function unresolvedProvenance(uncertainty: string) {
  return provenance("operational_recommendation", [], uncertainty);
}

describe("species enrichment request", () => {
  test("accepts a trimmed external species id and nothing else", () => {
    const parsed = parseSpeciesEnrichmentRequest({
      external_species_id: "  bramble-back  ",
    });

    assert.deepEqual(parsed, {
      ok: true,
      data: { external_species_id: "bramble-back" },
    });
    assert.equal(
      parseSpeciesEnrichmentRequest({ external_species_id: "bramble_back" }).ok,
      true,
    );
    assert.equal(
      parseSpeciesEnrichmentRequest({ external_species_id: "a".repeat(128) }).ok,
      true,
    );
  });

  test("rejects malformed identifiers and unexpected properties", () => {
    const samples: unknown[] = [
      {},
      { external_species_id: "" },
      { external_species_id: "   " },
      { external_species_id: "Bramble-back" },
      { external_species_id: "bramble back" },
      { external_species_id: "bramble/back" },
      { external_species_id: "../bramble-back" },
      { external_species_id: "-bramble-back" },
      { external_species_id: "bramble-back-" },
      { external_species_id: "bramble--back" },
      { external_species_id: "a".repeat(129) },
      { external_species_id: null },
      { external_species_id: 12 },
      { external_species_id: { id: "bramble-back" } },
      "bramble-back",
      null,
      {
        external_species_id: "bramble-back",
        display_name: "Invented Beast",
      },
    ];

    for (const sample of samples) {
      const parsed = parseSpeciesEnrichmentRequest(sample);
      assert.equal(parsed.ok, false);
      if (parsed.ok) continue;
      assert.equal(parsed.error.code, "validation");
      assert.equal(parsed.error.message, "Species identifier is invalid.");
    }
  });
});

describe("external species facts", () => {
  test("preserves nullable fields, booleans and string arrays", () => {
    const origins = ["fictional-reserve", "field-guide"];
    const parsed = externalSpeciesFactsSchema.safeParse(
      sourceRecord({ franchise_origins: origins, hybrid: true, region: null }),
    );

    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.scientific_name, "  Brambleback imaginarius  ");
    assert.equal(parsed.data.geological_period, null);
    assert.equal(parsed.data.region, null);
    assert.equal(parsed.data.hybrid, true);
    assert.deepEqual(parsed.data.franchise_origins, origins);
    assert.deepEqual(parsed.data.franchise_appearances, []);
  });

  test("rejects malformed facts and unexpected properties", () => {
    const samples = [
      sourceRecord({ id: "Bramble-back" }),
      sourceRecord({ scientific_name: null }),
      sourceRecord({ hybrid: "false" }),
      sourceRecord({ geological_period: 12 }),
      sourceRecord({ franchise_origins: null }),
      sourceRecord({ franchise_appearances: ["one", 2] }),
      sourceRecord({ display_name: "Invented Beast" }),
      sourceRecord({ external_species_id: "other-beast" }),
      {
        external_species_id: "other-beast",
        display_name: "Invented Beast",
        general_description: "Model authored.",
      },
    ];

    for (const sample of samples) {
      assert.equal(externalSpeciesFactsSchema.safeParse(sample).success, false);
    }
  });
});

describe("model enrichment proposal", () => {
  test("accepts a complete proposal with field provenance", () => {
    const parsed = validateSpeciesEnrichmentModelProposal(completeModel());

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.safety_class, "moderate");
    assert.equal(parsed.data.minimum_handlers, 2);
    assert.equal(
      parsed.data.provenance.handling_guidance.basis,
      "operational_recommendation",
    );
    assert.equal("external_species_id" in parsed.data, false);
    assert.equal("display_name" in parsed.data, false);
  });

  test("accepts explicit uncertainty when evidence is missing", () => {
    const gap = "The retrieved API fields do not support this value.";
    const model = {
      general_description: null,
      diet_preferences: null,
      habitat_preferences: null,
      handling_guidance: null,
      minimum_handlers: null,
      safety_class: null,
      provenance: {
        general_description: unresolvedProvenance(gap),
        diet_preferences: unresolvedProvenance(gap),
        habitat_preferences: provenance("api_interpretation", ["region"], gap),
        handling_guidance: unresolvedProvenance(gap),
        minimum_handlers: unresolvedProvenance(gap),
        safety_class: unresolvedProvenance(gap),
      },
    };

    const parsed = validateSpeciesEnrichmentModelProposal(model);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.general_description, null);
    assert.equal(parsed.data.minimum_handlers, null);
    assert.equal(parsed.data.safety_class, null);
    assert.equal(parsed.data.provenance.diet_preferences.uncertainty, gap);
    assert.deepEqual(parsed.data.provenance.diet_preferences.supporting_fields, []);
  });

  test("rejects blank non-null text in the post-validation step", () => {
    const blankDescription = {
      ...completeModel(),
      general_description: "   ",
    };
    assert.equal(
      speciesEnrichmentModelOutputSchema.safeParse(blankDescription).success,
      true,
    );

    const parsed = validateSpeciesEnrichmentModelProposal(blankDescription);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.message, "The enrichment proposal is invalid.");

    const blankUncertainty = completeModel();
    blankUncertainty.provenance.diet_preferences = provenance(
      "api_interpretation",
      ["diet_profile"],
      "  ",
    );
    assert.equal(
      validateSpeciesEnrichmentModelProposal(blankUncertainty).ok,
      false,
    );
  });

  test("trims meaningful text and keeps internal spaces", () => {
    const model = completeModel();
    model.general_description = "  Marsh grazer.  ";
    const parsed = validateSpeciesEnrichmentModelProposal(model);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.general_description, "Marsh grazer.");
  });

  test("rejects invalid safety classifications", () => {
    for (const safetyClass of ["extreme", "LOW", "", "severe"]) {
      const parsed = validateSpeciesEnrichmentModelProposal({
        ...completeModel(),
        safety_class: safetyClass,
      });
      assert.equal(parsed.ok, false);
    }
  });

  test("rejects zero, negative, fractional and out-of-range handler counts", () => {
    for (const count of [0, -1, 1.5, 32_768, Number.NaN, "2"]) {
      const parsed = validateSpeciesEnrichmentModelProposal({
        ...completeModel(),
        minimum_handlers: count,
      });
      assert.equal(parsed.ok, false, `expected rejection for ${String(count)}`);
    }

    assert.equal(
      validateSpeciesEnrichmentModelProposal({
        ...completeModel(),
        minimum_handlers: 1,
      }).ok,
      true,
    );
    assert.equal(
      validateSpeciesEnrichmentModelProposal({
        ...completeModel(),
        minimum_handlers: 32_767,
      }).ok,
      true,
    );
  });

  test("rejects provenance that does not cite a real API field", () => {
    const model = completeModel();
    model.provenance.diet_preferences = provenance(
      "api_interpretation",
      ["display_name"],
      null,
    );
    assert.equal(validateSpeciesEnrichmentModelProposal(model).ok, false);

    const generatedField = completeModel();
    generatedField.provenance.habitat_preferences = provenance(
      "api_interpretation",
      ["general_description"],
      null,
    );
    assert.equal(validateSpeciesEnrichmentModelProposal(generatedField).ok, false);

    const unsupported = completeModel();
    unsupported.provenance.safety_class = provenance(
      "operational_recommendation",
      [],
      null,
    );
    assert.equal(validateSpeciesEnrichmentModelProposal(unsupported).ok, false);

    const openGap = completeModel();
    const silentGap = {
      ...openGap,
      general_description: null,
      provenance: {
        ...openGap.provenance,
        general_description: provenance("api_interpretation", [], null),
      },
    };
    assert.equal(validateSpeciesEnrichmentModelProposal(silentGap).ok, false);
  });

  test("rejects unexpected properties and model-authored identity fields", () => {
    assert.equal(
      validateSpeciesEnrichmentModelProposal({
        ...completeModel(),
        confidence: 0.8,
      }).ok,
      false,
    );
    assert.equal(
      validateSpeciesEnrichmentModelProposal({
        ...completeModel(),
        external_species_id: "other-beast",
        display_name: "Invented Beast",
      }).ok,
      false,
    );

    const withConfidence = completeModel();
    assert.equal(
      speciesEnrichmentModelOutputSchema.safeParse({
        ...withConfidence,
        provenance: {
          ...withConfidence.provenance,
          safety_class: {
            ...withConfidence.provenance.safety_class,
            confidence: 80,
          },
        },
      }).success,
      false,
    );
  });
});

describe("assembled species enrichment proposal", () => {
  test("copies server-owned identity and derives the display name", () => {
    const source = sourceRecord();
    const model = completeModel();
    model.general_description = "Staff sometimes call it the amber grazer.";
    const result = assembleSpeciesEnrichmentProposal({
      source,
      modelProposal: model,
      retrievedAt: RETRIEVED_AT,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.retrieval.system, EXTERNAL_SPECIES_SOURCE_SYSTEM);
    assert.equal(result.data.retrieval.external_species_id, "bramble-back");
    assert.equal(result.data.retrieval.retrieved_at, RETRIEVED_AT);
    assert.equal(result.data.api_content_authority, API_CONTENT_AUTHORITY);
    assert.equal(result.data.api_facts.scientific_name, source.scientific_name);
    assert.equal(result.data.api_facts.geological_period, null);
    assert.equal(
      result.data.proposed_entry.external_species_id,
      source.id,
    );
    assert.equal(
      result.data.proposed_entry.display_name,
      "Brambleback imaginarius",
    );
    assert.equal(
      result.data.proposed_entry.general_description,
      "Staff sometimes call it the amber grazer.",
    );
    assert.notEqual(
      result.data.proposed_entry.display_name,
      result.data.proposed_entry.general_description,
    );
  });

  test("leaves display name null when the scientific name is unusable", () => {
    const result = assembleSpeciesEnrichmentProposal({
      source: sourceRecord({ scientific_name: " \n\t " }),
      modelProposal: completeModel(),
      retrievedAt: "2026-11-03T23:15:00+01:00",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.proposed_entry.display_name, null);
    assert.equal(result.data.proposed_entry.external_species_id, "bramble-back");
    assert.equal(result.data.retrieval.retrieved_at, "2026-11-03T23:15:00+01:00");
    assert.equal(result.data.api_facts.scientific_name, " \n\t ");
  });

  test("does not treat model identity fields as API facts", () => {
    const authored = {
      ...completeModel(),
      external_species_id: "other-beast",
      display_name: "Invented Beast",
    };
    const result = assembleSpeciesEnrichmentProposal({
      source: sourceRecord(),
      modelProposal: authored,
      retrievedAt: RETRIEVED_AT,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.message, "The enrichment proposal is invalid.");
    assert.equal(externalSpeciesFactsSchema.safeParse(authored).success, false);
  });

  test("rejects an unexpected source property and a bad timestamp", () => {
    const extra = assembleSpeciesEnrichmentProposal({
      source: sourceRecord({ unexpected_extra: "ignore me" }),
      modelProposal: completeModel(),
      retrievedAt: RETRIEVED_AT,
    });
    assert.equal(extra.ok, false);
    if (!extra.ok) {
      assert.equal(extra.error.message, "The external species data is invalid.");
    }

    const timestamp = assembleSpeciesEnrichmentProposal({
      source: sourceRecord(),
      modelProposal: completeModel(),
      retrievedAt: "2026-11-03",
    });
    assert.equal(timestamp.ok, false);
    if (!timestamp.ok) {
      assert.equal(timestamp.error.message, "The retrieval timestamp is invalid.");
    }
  });

  test("does not perform network access while assembling", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network");
    };
    try {
      const result = assembleSpeciesEnrichmentProposal({
        source: sourceRecord(),
        modelProposal: completeModel(),
        retrievedAt: RETRIEVED_AT,
      });
      assert.equal(result.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps the stored proposal strict about authority and blank text", () => {
    const result = assembleSpeciesEnrichmentProposal({
      source: sourceRecord(),
      modelProposal: completeModel(),
      retrievedAt: RETRIEVED_AT,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(
      speciesEnrichmentProposalSchema.safeParse({
        ...result.data,
        api_content_authority: "approved_fact",
      }).success,
      false,
    );
    assert.equal(
      speciesEnrichmentProposalSchema.safeParse({
        ...result.data,
        proposed_entry: {
          ...result.data.proposed_entry,
          handling_guidance: "   ",
        },
      }).success,
      false,
    );
    assert.equal(
      speciesEnrichmentProposalSchema.safeParse({
        ...result.data,
        confidence: 1,
      }).success,
      false,
    );
  });
});

describe("model output JSON schema", () => {
  test("converts the model fields to JSON Schema", () => {
    const schema = z.toJSONSchema(speciesEnrichmentModelOutputSchema);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.equal(typeof schema.properties, "object");
    if (schema.properties == null || Array.isArray(schema.properties)) return;

    assert.equal("display_name" in schema.properties, false);
    assert.equal("external_species_id" in schema.properties, false);
    assert.equal("general_description" in schema.properties, true);
    assert.equal("provenance" in schema.properties, true);

    const encoded = JSON.stringify(schema);
    assert.equal(encoded.includes("\"moderate\""), true);
    assert.equal(encoded.includes("\"critical\""), true);
    assert.equal(encoded.includes("\"integer\""), true);
    assert.equal(encoded.includes("32767"), true);
  });
});
