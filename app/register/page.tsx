import { RegisterForm } from "@/components/register-form";
import { RegisterUnavailable } from "@/components/register-unavailable";
import { isPublicRegistrationEnabled } from "@/lib/auth/public-registration";

export default function RegisterPage() {
  if (!isPublicRegistrationEnabled()) {
    return <RegisterUnavailable />;
  }

  return <RegisterForm />;
}
