import { redirect } from "next/navigation";

import SetPasswordForm from "@/components/set-password-form";
import { createClient } from "@/lib/supabase/server";

export default async function SetPasswordPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (process.env.NODE_ENV === "development") {
    console.info("[set-password] session check", {
      hasAuthenticatedUser: Boolean(user),
    });
  }

  if (!user) {
    redirect("/login");
  }

  return <SetPasswordForm />;
}
