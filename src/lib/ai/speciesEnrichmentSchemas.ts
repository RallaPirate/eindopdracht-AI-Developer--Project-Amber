import { z } from "zod";

import { err, ok, type AppResult } from "../appResult.ts";
import type { ExternalSpecies } from "../externalSpecies.ts";

/**
 * Temporary Species Enrichment proposal contract.
 *
 * The model output schema is the only schema intended for provider-side
 * structured output. It stays within checks Zod can represent as JSON Schema.
 * Blank text and evidence rules are applied afterwards by
 * `validateSpeciesEnrichmentModelProposal`. Identity fields are copied from
 * the validated external record by `assembleSpeciesEnrichmentProposal`.
 *
 * A proposal may leave generated fields null. Section 4 of the database
 * design still requires complete, non-blank values before a
 * `species_database` row is inserted. This module does not insert anything.
 */

/** Same slug accepted by `getExternalSpecies`. */
const EXTERNAL_SPECIES_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const MAX_EXTERNAL_SPECIES_ID_LENGTH = 128;

/** PostgreSQL `smallint` upper bound. The column also requires a value > 0. */
const POSTGRES_SMALLINT_MAX = 32_767;

export const EXTERNAL_SPECIES_FIELD_NAMES = [
  "id",
  "scientific_name",
  "diet_profile",
  "geological_period",
  "region",
  "social_requirements",
  "general_care_recommendations",
  "hybrid",
  "franchise_origins",
  "franchise_appearances",
] as const;

export const SPECIES_ENRICHMENT_GENERATED_FIELDS = [
  "general_description",
  "diet_preferences",
  "habitat_preferences",
  "handling_guidance",
  "minimum_handlers",
  "safety_class",
] as const;

export const SAFETY_CLASSES = ["low", "moderate", "high", "critical"] as const;

export const ENRICHMENT_FIELD_BASES = [
  "api_interpretation",
  "operational_recommendation",
] as const;

/** Fixed by application code. Structural validity is not content authority. */
export const API_CONTENT_AUTHORITY = "untrusted_api_reference" as const;

export const EXTERNAL_SPECIES_SOURCE_SYSTEM = "external_species_api" as const;

const MESSAGES = {
  invalidRequest: "Species identifier is invalid.",
  invalidSource: "The external species data is invalid.",
  invalidProposal: "The enrichment proposal is invalid.",
  invalidRetrievedAt: "The retrieval timestamp is invalid.",
} as const;

const canonicalSpeciesIdSchema = z
  .string()
  .max(MAX_EXTERNAL_SPECIES_ID_LENGTH)
  .regex(EXTERNAL_SPECIES_ID_PATTERN);

/**
 * Caller-supplied request. Trim runs during parse and is omitted from JSON
 * Schema, so this schema is not a model output schema.
 */
export const speciesEnrichmentRequestSchema = z.strictObject({
  external_species_id: z
    .string()
    .trim()
    .max(MAX_EXTERNAL_SPECIES_ID_LENGTH)
    .regex(EXTERNAL_SPECIES_ID_PATTERN),
});

export type SpeciesEnrichmentRequest = z.infer<
  typeof speciesEnrichmentRequestSchema
>;

/**
 * Ten fields returned by the external Species API.
 * A successful parse confirms structure only. Values remain untrusted
 * reference data: `general_care_recommendations` is not an instruction
 * and is not an approved operational decision.
 */
export const externalSpeciesFactsSchema = z.strictObject({
  id: canonicalSpeciesIdSchema,
  scientific_name: z.string(),
  diet_profile: z.string(),
  geological_period: z.string().nullable(),
  region: z.string().nullable(),
  social_requirements: z.string(),
  general_care_recommendations: z.string(),
  hybrid: z.boolean(),
  franchise_origins: z.array(z.string()),
  franchise_appearances: z.array(z.string()),
});

export type ExternalSpeciesFacts = z.infer<typeof externalSpeciesFactsSchema>;

const externalSpeciesFieldNameSchema = z.enum(EXTERNAL_SPECIES_FIELD_NAMES);
const safetyClassSchema = z.enum(SAFETY_CLASSES);
const enrichmentBasisSchema = z.enum(ENRICHMENT_FIELD_BASES);

const minimumHandlersSchema = z
  .number()
  .int()
  .min(1)
  .max(POSTGRES_SMALLINT_MAX);

const modelFieldProvenanceSchema = z
  .strictObject({
    basis: enrichmentBasisSchema.describe(
      "api_interpretation explains retrieved API fields. operational_recommendation proposes reserve procedure and is not an API fact.",
    ),
    supporting_fields: z
      .array(externalSpeciesFieldNameSchema)
      .describe(
        "External Species API field names that support this value. Use an empty array when none do.",
      ),
    uncertainty: z
      .string()
      .nullable()
      .describe(
        "Missing, weak or conflicting evidence, in words. Null when there is no material gap. Do not supply a confidence percentage.",
      ),
  })
  .describe("Provenance for one proposed field.");

const modelProvenanceShape = {
  general_description: modelFieldProvenanceSchema,
  diet_preferences: modelFieldProvenanceSchema,
  habitat_preferences: modelFieldProvenanceSchema,
  handling_guidance: modelFieldProvenanceSchema,
  minimum_handlers: modelFieldProvenanceSchema,
  safety_class: modelFieldProvenanceSchema,
} as const;

/**
 * Model-authored portion of a species enrichment proposal.
 * Suitable for Vercel AI SDK structured output. It does not include
 * `external_species_id` or `display_name`.
 */
export const speciesEnrichmentModelOutputSchema = z
  .strictObject({
    general_description: z
      .string()
      .nullable()
      .describe(
        "Proposed introductory description, or null when the API facts are insufficient. Do not invent missing detail.",
      ),
    diet_preferences: z
      .string()
      .nullable()
      .describe(
        "Proposed diet description, or null when the API facts are insufficient.",
      ),
    habitat_preferences: z
      .string()
      .nullable()
      .describe(
        "Proposed habitat description, or null when the API facts are insufficient.",
      ),
    handling_guidance: z
      .string()
      .nullable()
      .describe(
        "Proposed operational handling guidance, or null when a procedure cannot be supported. This is not an approved instruction.",
      ),
    minimum_handlers: minimumHandlersSchema
      .nullable()
      .describe(
        "Proposed minimum qualified handlers for ordinary handling, or null when that number cannot be supported.",
      ),
    safety_class: safetyClassSchema
      .nullable()
      .describe(
        "Proposed safety classification, or null when the classification cannot be supported.",
      ),
    provenance: z.strictObject(modelProvenanceShape),
  })
  .describe(
    "Enrichment for six species_database fields. The application assigns external_species_id and display_name; do not include them.",
  );

export type SpeciesEnrichmentModelOutput = z.infer<
  typeof speciesEnrichmentModelOutputSchema
>;

const storedTextSchema = z.string().trim().min(1);
const storedUncertaintySchema = storedTextSchema.nullable();
const nonBlankTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0)
  .refine((value) => !value.includes("\u0000"), "Text must not contain a NUL character.");
const persistableSpeciesTextSchema = nonBlankTextSchema.refine(
  // Unicode mode matches surrogate code points only when they are unpaired.
  (value) => !/[\uD800-\uDFFF]/u.test(value),
  "Text must not contain unpaired UTF-16 surrogates.",
);
const proposedSpeciesTextSchema = storedTextSchema.pipe(persistableSpeciesTextSchema).nullable();

const storedFieldProvenanceSchema = z.strictObject({
  basis: enrichmentBasisSchema,
  supporting_fields: z.array(externalSpeciesFieldNameSchema),
  uncertainty: storedUncertaintySchema,
});

const storedProvenanceShape = {
  general_description: storedFieldProvenanceSchema,
  diet_preferences: storedFieldProvenanceSchema,
  habitat_preferences: storedFieldProvenanceSchema,
  handling_guidance: storedFieldProvenanceSchema,
  minimum_handlers: storedFieldProvenanceSchema,
  safety_class: storedFieldProvenanceSchema,
} as const;

const proposedSpeciesEntrySchema = z.strictObject({
  external_species_id: canonicalSpeciesIdSchema,
  display_name: proposedSpeciesTextSchema,
  general_description: proposedSpeciesTextSchema,
  diet_preferences: proposedSpeciesTextSchema,
  habitat_preferences: proposedSpeciesTextSchema,
  handling_guidance: proposedSpeciesTextSchema,
  minimum_handlers: minimumHandlersSchema.nullable(),
  safety_class: safetyClassSchema.nullable(),
});

const retrievalTimestampSchema = z.iso.datetime({ offset: true });

/**
 * Assembled temporary proposal. Not an insertable `species_database` row:
 * unresolved text, handler count, safety class and display name may be null.
 */
export const speciesEnrichmentProposalSchema = z.strictObject({
  retrieval: z.strictObject({
    system: z.literal(EXTERNAL_SPECIES_SOURCE_SYSTEM),
    external_species_id: canonicalSpeciesIdSchema,
    retrieved_at: retrievalTimestampSchema,
  }),
  api_content_authority: z.literal(API_CONTENT_AUTHORITY),
  api_facts: externalSpeciesFactsSchema,
  proposed_entry: proposedSpeciesEntrySchema,
  provenance: z.strictObject(storedProvenanceShape),
});

export type SpeciesEnrichmentProposal = z.infer<
  typeof speciesEnrichmentProposalSchema
>;

const completableSpeciesFields = {
  display_name: persistableSpeciesTextSchema,
  general_description: persistableSpeciesTextSchema,
  diet_preferences: persistableSpeciesTextSchema,
  habitat_preferences: persistableSpeciesTextSchema,
  handling_guidance: persistableSpeciesTextSchema,
  minimum_handlers: minimumHandlersSchema,
  safety_class: safetyClassSchema,
};

const acceptedSpeciesEntrySchema = z.strictObject({
  external_species_id: canonicalSpeciesIdSchema,
  ...completableSpeciesFields,
});

function managementCompletionSchema<T extends z.ZodType>(value: T) {
  return z.strictObject({ value, justification: nonBlankTextSchema });
}

const managementCompletionsSchema = z.strictObject({
  display_name: managementCompletionSchema(completableSpeciesFields.display_name),
  general_description: managementCompletionSchema(completableSpeciesFields.general_description),
  diet_preferences: managementCompletionSchema(completableSpeciesFields.diet_preferences),
  habitat_preferences: managementCompletionSchema(completableSpeciesFields.habitat_preferences),
  handling_guidance: managementCompletionSchema(completableSpeciesFields.handling_guidance),
  minimum_handlers: managementCompletionSchema(completableSpeciesFields.minimum_handlers),
  safety_class: managementCompletionSchema(completableSpeciesFields.safety_class),
}).partial();

/** Checks acceptance against the original assembled proposal supplied to this contract. */
export const speciesEnrichmentAcceptanceSchema = z.strictObject({
  proposal: speciesEnrichmentProposalSchema,
  accepted_entry: acceptedSpeciesEntrySchema,
  management_completions: managementCompletionsSchema,
}).superRefine(({ proposal, accepted_entry, management_completions }, ctx) => {
  const { api_facts, retrieval, proposed_entry, provenance } = proposal;
  const { external_species_id, display_name, ...generatedFields } = proposed_entry;
  const id = api_facts.id;
  if (
    retrieval.external_species_id !== id ||
    external_species_id !== id ||
    accepted_entry.external_species_id !== id
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["accepted_entry", "external_species_id"],
      message: "All species identifiers must match the API record.",
    });
  }

  if (
    display_name !== deriveDisplayName(api_facts.scientific_name) ||
    !validateSpeciesEnrichmentModelProposal({ ...generatedFields, provenance }).ok
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["proposal"],
      message: "Expected an assembled enrichment proposal.",
    });
  }

  for (const field of ["display_name", ...SPECIES_ENRICHMENT_GENERATED_FIELDS] as const) {
    const original = proposed_entry[field];
    const completion = management_completions[field];
    if (original === null) {
      if (!completion || completion.value !== accepted_entry[field]) {
        ctx.addIssue({
          code: "custom",
          path: ["management_completions", field],
          message: "An unresolved field requires a completion matching the accepted value.",
        });
      }
      continue;
    }

    if (Object.hasOwn(management_completions, field)) {
      ctx.addIssue({
        code: "custom",
        path: ["management_completions", field],
        message: "Only unresolved fields may receive Management completions.",
      });
    }
    if (accepted_entry[field] !== original) {
      ctx.addIssue({
        code: "custom",
        path: ["accepted_entry", field],
        message: "The accepted value must match the original proposal.",
      });
    }
  }
});

export type SpeciesEnrichmentAcceptance = z.infer<typeof speciesEnrichmentAcceptanceSchema>;

const GENERATED_TEXT_FIELDS = [
  "general_description",
  "diet_preferences",
  "habitat_preferences",
  "handling_guidance",
] as const;

type GeneratedTextField = (typeof GENERATED_TEXT_FIELDS)[number];

function isGeneratedTextField(field: string): field is GeneratedTextField {
  return (GENERATED_TEXT_FIELDS as readonly string[]).includes(field);
}

function meaningfulText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalises a structurally valid model proposal.
 * Blank non-null text is rejected rather than stored or coerced to null.
 * A null value must carry a non-blank uncertainty. A non-null value must
 * cite at least one real external API field.
 */
export function validateSpeciesEnrichmentModelProposal(
  value: unknown,
): AppResult<SpeciesEnrichmentModelOutput> {
  const parsed = speciesEnrichmentModelOutputSchema.safeParse(value);
  if (!parsed.success) {
    return err("validation", MESSAGES.invalidProposal);
  }

  const normalized = { ...parsed.data, provenance: { ...parsed.data.provenance } };

  for (const field of SPECIES_ENRICHMENT_GENERATED_FIELDS) {
    const provenance = { ...parsed.data.provenance[field] };
    const rawValue = parsed.data[field];

    if (isGeneratedTextField(field) && typeof rawValue === "string") {
      const text = meaningfulText(rawValue);
      if (text === null) {
        return err("validation", MESSAGES.invalidProposal);
      }
      normalized[field] = text;
    }

    if (provenance.uncertainty !== null) {
      const uncertainty = meaningfulText(provenance.uncertainty);
      if (uncertainty === null) {
        return err("validation", MESSAGES.invalidProposal);
      }
      provenance.uncertainty = uncertainty;
    }

    const valueIsMissing = normalized[field] === null;
    if (valueIsMissing && provenance.uncertainty === null) {
      return err("validation", MESSAGES.invalidProposal);
    }
    if (!valueIsMissing && provenance.supporting_fields.length === 0) {
      return err("validation", MESSAGES.invalidProposal);
    }

    normalized.provenance[field] = provenance;
  }

  return ok(normalized);
}

function deriveDisplayName(scientificName: string): string | null {
  return meaningfulText(scientificName);
}

export type SpeciesEnrichmentAssemblyInput = {
  source: ExternalSpecies;
  modelProposal: unknown;
  retrievedAt: string;
};

/**
 * Combines a validated external record, a model proposal and a
 * caller-supplied retrieval timestamp. Copies `external_species_id` from
 * the API id and derives `display_name` only from the trimmed scientific
 * name. Does not perform network or database access.
 */
export function assembleSpeciesEnrichmentProposal(
  input: SpeciesEnrichmentAssemblyInput,
): AppResult<SpeciesEnrichmentProposal> {
  const typedSource: ExternalSpeciesFacts = input.source;
  const parsedSource = externalSpeciesFactsSchema.safeParse(typedSource);
  if (!parsedSource.success) {
    return err("validation", MESSAGES.invalidSource);
  }
  const facts: ExternalSpecies = parsedSource.data;

  const retrievedAt = retrievalTimestampSchema.safeParse(input.retrievedAt);
  if (!retrievedAt.success) {
    return err("validation", MESSAGES.invalidRetrievedAt);
  }

  const model = validateSpeciesEnrichmentModelProposal(input.modelProposal);
  if (!model.ok) return model;

  const proposal: SpeciesEnrichmentProposal = {
    retrieval: {
      system: EXTERNAL_SPECIES_SOURCE_SYSTEM,
      external_species_id: facts.id,
      retrieved_at: retrievedAt.data,
    },
    api_content_authority: API_CONTENT_AUTHORITY,
    api_facts: facts,
    proposed_entry: {
      external_species_id: facts.id,
      display_name: deriveDisplayName(facts.scientific_name),
      general_description: model.data.general_description,
      diet_preferences: model.data.diet_preferences,
      habitat_preferences: model.data.habitat_preferences,
      handling_guidance: model.data.handling_guidance,
      minimum_handlers: model.data.minimum_handlers,
      safety_class: model.data.safety_class,
    },
    provenance: model.data.provenance,
  };

  const checked = speciesEnrichmentProposalSchema.safeParse(proposal);
  if (!checked.success) {
    return err("validation", MESSAGES.invalidProposal);
  }
  return ok(checked.data);
}

export function parseSpeciesEnrichmentRequest(
  value: unknown,
): AppResult<SpeciesEnrichmentRequest> {
  const parsed = speciesEnrichmentRequestSchema.safeParse(value);
  if (!parsed.success) {
    return err("validation", MESSAGES.invalidRequest);
  }
  return ok(parsed.data);
}
