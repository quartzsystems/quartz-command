"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthClient } from "@/lib/authClient";

/// Minimal inline eye icons (avoids an icon dependency for one control).
/// Ported verbatim from QuartzFire's login page.
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/// Shared sign-in card. The user and admin realms render the identical UI (the
/// QuartzFire login page), differing only in heading, which client they call,
/// the caption, and where they land on success. Credentials are verified
/// server-side, which sets an httpOnly session cookie.
export function LoginForm({
  client,
  title,
  caption,
  successPath,
}: {
  client: AuthClient;
  title: string;
  caption: string;
  successPath: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Already signed in? Skip straight to the console.
  useEffect(() => {
    client
      .fetchMe()
      .then(() => router.replace(successPath))
      .catch(() => {});
  }, [router, client, successPath]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await client.login(email, password);
      router.push(successPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const inputBase =
    "w-full rounded-md px-3 py-[10px] text-[13px] text-[var(--qz-fg-1)] outline-none transition-colors";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "var(--qz-bg)" }}
    >
      <div
        className="w-full max-w-[360px] rounded-xl p-8 flex flex-col gap-6"
        style={{
          background: "var(--qz-ink-0)",
          border: "1px solid var(--qz-border)",
          boxShadow: "var(--qz-shadow-3)",
        }}
      >
        {/* Logo + heading */}
        <div className="flex items-center justify-center gap-3">
          <img src="/logo-mark.png" alt="Quartz Systems" className="w-9 h-9" />
          <h1
            className="text-[22px] font-bold text-[var(--qz-fg-1)] m-0"
            style={{ letterSpacing: "-0.02em" }}
          >
            {title}
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              autoComplete="username"
              className={inputBase}
              style={{
                background: "var(--qz-input-bg)",
                border: "1px solid var(--qz-border)",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--qz-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--qz-border)")}
            />
          </div>

          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className={`${inputBase} pr-10`}
                style={{
                  background: "var(--qz-input-bg)",
                  border: "1px solid var(--qz-border)",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--qz-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--qz-border)")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--qz-fg-4)] hover:text-[var(--qz-fg-2)] transition-colors cursor-pointer bg-transparent border-0 p-0"
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
          </div>

          {error && (
            <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md py-[10px] text-[13.5px] font-semibold transition-opacity cursor-pointer border-0 mt-1"
            style={{
              background: "var(--qz-accent)",
              color: "var(--qz-fg-on-accent)",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-[11px] text-center m-0" style={{ color: "var(--qz-fg-4)" }}>
          {caption}
        </p>
      </div>
    </div>
  );
}
