"use client";

import { useAuthenticatedMutation } from "@/hooks/useAuthenticatedQuery";
import { requestFreshAuthQuerySync } from "@/lib/authQueryIsolation";
import { getVerifiedAuthSnapshot } from "@/lib/queryClient";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { createSpeciesUpdateMutation } from "@/components/programs/speciesDatabaseUpdate";

/** Senior/Management species edit for the species browser. */
export function useUpdateLocalSpecies() {
  return useAuthenticatedMutation(
    createSpeciesUpdateMutation({
      supabase: getSupabaseBrowserClient,
      started: getVerifiedAuthSnapshot,
      refreshAccess: requestFreshAuthQuerySync,
      accessAfter: getVerifiedAuthSnapshot,
    }),
  );
}
