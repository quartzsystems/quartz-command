"use client";

import { LoginForm } from "@/components/LoginForm";
import * as adminApi from "@/lib/adminApi";

/// Admin sign-in page. Verifies against the separate `admins` table and, on
/// success, lands on /admin. A distinct cookie + JWT secret keep this session
/// fully separate from the user realm.
export default function AdminLoginPage() {
  return (
    <LoginForm
      client={adminApi}
      title="Command Admin"
      caption="Restricted — platform administrators only."
      successPath="/admin"
    />
  );
}
