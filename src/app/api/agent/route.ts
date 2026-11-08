import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/currentProfile";
import { getOpenAiLanguageModel } from "@/lib/ai/model";
import { handleAssistantPost } from "@/lib/ai/assistantEndpoint";

export const maxDuration = 60;

export function POST(request: Request): Promise<Response> {
  return handleAssistantPost(request, { getCurrentProfile, getModel: getOpenAiLanguageModel });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
