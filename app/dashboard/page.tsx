import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fullName =
    user.user_metadata?.full_name || user.email || "Customer";

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">
              Candid OS
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">
              Welcome, {fullName}
            </h1>

            <p className="mt-2 text-neutral-600">
              {companyName}
            </p>
          </div>
        </header>

        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-neutral-500">Quotes</p>
            <p className="mt-3 text-3xl font-semibold">0</p>
            <p className="mt-2 text-sm text-neutral-500">
              Current and historic quotes
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-neutral-500">
              Quote requests
            </p>
            <p className="mt-3 text-3xl font-semibold">0</p>
            <p className="mt-2 text-sm text-neutral-500">
              Requests awaiting review
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-neutral-500">
              Account status
            </p>
            <p className="mt-3 text-lg font-semibold text-amber-700">
              Pending approval
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              Candid will confirm your company access.
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold">
            Request a quote
          </h2>

          <p className="mt-2 text-neutral-600">
            Quote requests and mandatory delivery details will be added next.
          </p>
        </div>
      </div>
    </main>
  );
}