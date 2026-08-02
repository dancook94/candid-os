import { redirect } from "next/navigation";

import SetPasswordForm from "@/components/set-password-form";
import { createClient } from "@/lib/supabase/server";

export default async function SetPasswordPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <SetPasswordForm />;
}
