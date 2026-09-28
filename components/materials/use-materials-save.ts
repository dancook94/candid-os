"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function useMaterialsSave() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save(
    url: string,
    method: "POST" | "PATCH",
    body: unknown
  ) {
    setPending(true);
    setError("");

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save.");
        return null;
      }

      router.refresh();
      return payload.id ?? "saved";
    } catch {
      setError("Unable to save.");
      return null;
    } finally {
      setPending(false);
    }
  }

  return { error, pending, save, setError };
}
