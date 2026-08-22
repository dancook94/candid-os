"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function ReturnToLoginButton() {
  const router = useRouter();
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleReturnToLogin() {
    setIsSubmitting(true);

    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      className="h-10 w-full"
      disabled={isSubmitting}
      onClick={() => void handleReturnToLogin()}
    >
      {isSubmitting ? "Signing out..." : "Return to login"}
    </Button>
  );
}
