"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setIsSubmitting(true);

    const { error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    setIsSubmitting(false);

    if (signInError) {
      setError("Incorrect email address or password.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-neutral-500">
            Candid OS
          </p>

          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
            Sign in
          </h1>

          <p className="mt-2 text-sm text-neutral-600">
            Access your quotes and Candid projects.
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-neutral-800"
            >
              Email address
            </label>

            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none transition focus:border-neutral-950"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-sm font-medium text-neutral-800"
              >
                Password
              </label>

              <Link
                href="/forgot-password"
                className="text-sm font-medium text-neutral-600 underline underline-offset-4"
              >
                Forgot password?
              </Link>
            </div>

            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none transition focus:border-neutral-950"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-neutral-950 px-4 py-3 font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-600">
          Need an account?{" "}
          <Link
            href="/register"
            className="font-medium text-neutral-950 underline underline-offset-4"
          >
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}