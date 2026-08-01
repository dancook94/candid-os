import { Suspense } from "react";

import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="public-auth-page flex min-h-screen items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading sign in...</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
