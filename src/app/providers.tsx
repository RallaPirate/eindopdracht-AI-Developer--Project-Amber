"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { startAuthQueryIsolation } from "@/lib/authQueryIsolation";
import { getQueryClient } from "@/lib/queryClient";

function AuthQueryIsolation() {
  useEffect(() => startAuthQueryIsolation(), []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryIsolation />
      {children}
    </QueryClientProvider>
  );
}
