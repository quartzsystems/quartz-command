"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type AuthClient } from "@/lib/authClient";

/// Auth gate for protected pages (ported from QuartzFire's AuthGuard). The
/// session is an httpOnly cookie (invisible to JS), so we confirm it with the
/// backend via the realm's /me. The server enforces auth on every request
/// regardless; this just avoids rendering protected UI for an unauthenticated
/// visitor and refreshes the cached user.
///
/// Only a 401 sends the visitor to the login page. A 5xx / network failure
/// means the backend is down or restarting — bouncing then would ping-pong with
/// the login page's "already signed in" redirect, so we keep the console up when
/// we have a cached session or show a retry screen otherwise.
export function RealmGuard({
  client,
  loginPath,
  offlineLabel,
  children,
}: {
  client: AuthClient;
  loginPath: string;
  offlineLabel: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "authed" | "offline">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .fetchMe()
      .then(() => !cancelled && setState("authed"))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(loginPath);
        } else if (client.getCurrentUser()) {
          setState("authed");
        } else {
          setState("offline");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, attempt, client, loginPath]);

  if (state === "checking") return null;

  if (state === "offline") {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: "var(--qz-bg)" }}
      >
        <p className="text-[13px] m-0" style={{ color: "var(--qz-danger)" }}>
          {offlineLabel}
        </p>
        <button
          onClick={() => {
            setState("checking");
            setAttempt((n) => n + 1);
          }}
          className="rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer border-0"
          style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
