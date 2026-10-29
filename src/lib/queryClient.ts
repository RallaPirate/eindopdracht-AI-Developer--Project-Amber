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
