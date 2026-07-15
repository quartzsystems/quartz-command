"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/// The site root just forwards into the console; /cloud's guard bounces
/// unauthenticated visitors to /login.
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/cloud");
  }, [router]);
  return null;
}
