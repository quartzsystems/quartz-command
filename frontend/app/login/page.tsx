"use client";

import { LoginForm } from "@/components/LoginForm";
import * as api from "@/lib/api";

/// Sign-in page for the cloud console. Verifies against the `users` table and,
/// on success, lands on /cloud.
export default function LoginPage() {
  return (
    <LoginForm
      client={api}
      title="Quartz Command"
      caption="Sign in with your Quartz Command account."
      successPath="/cloud"
    />
  );
}
