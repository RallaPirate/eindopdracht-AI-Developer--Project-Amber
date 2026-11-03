import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Safe failure text for missing server configuration.
 * Must not include credential or model values.
 */
export const AI_MODEL_NOT_CONFIGURED =
  "The language model is not configured.";

export type OpenAiLanguageModelResult =
  | { ok: true; model: LanguageModel }
  | { ok: false; message: typeof AI_MODEL_NOT_CONFIGURED };

function readNonEmptyEnv(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Builds an OpenAI language model for server-side Agent calls.
 *
 * `OPENAI_API_KEY` and `OPENAI_MODEL` are read only when this function runs.
 * The provider receives the key through its standard `apiKey` setting.
 * Calling this function does not send a request.
 */
export function getOpenAiLanguageModel(): OpenAiLanguageModelResult {
  const apiKey = readNonEmptyEnv(process.env.OPENAI_API_KEY);
  const modelId = readNonEmptyEnv(process.env.OPENAI_MODEL);

  if (!apiKey || !modelId) {
    return { ok: false, message: AI_MODEL_NOT_CONFIGURED };
  }

  const openai = createOpenAI({ apiKey });
  return { ok: true, model: openai(modelId) };
}
