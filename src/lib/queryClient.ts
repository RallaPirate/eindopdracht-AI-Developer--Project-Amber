import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid immediate client refetch after SSR / initial hydration.
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always create a new client so request data is not shared.
    return makeQueryClient();
  }

  // Browser: reuse one client across renders (important if React suspends).
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

/**
 * Clears all cached query data in the browser QueryClient.
 * Call on login, registration and account switch so user-specific cache
 * cannot leak across Auth sessions.
 *
 * When authenticated feature queries are introduced, also include the
 * verified user id in query keys as defence in depth.
 */
export function clearBrowserQueryCache() {
  if (typeof window === "undefined") return;
  browserQueryClient?.clear();
}
