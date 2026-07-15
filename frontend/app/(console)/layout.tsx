"use client";

import { RealmGuard } from "@/components/RealmGuard";
import * as api from "@/lib/api";

/// Wraps every console page (/cloud and below) in the user-realm auth gate.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealmGuard
      client={api}
      loginPath="/login"
      offlineLabel="Cannot reach the Quartz Command backend. It may be restarting."
    >
      {children}
    </RealmGuard>
  );
}
