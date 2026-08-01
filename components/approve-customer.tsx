"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type Company = {
  id: string;
  company_name: string;
};

type ApproveCustomerProps = {
  profileId: string;
  companies: Company[];
};

export function ApproveCustomer({
  profileId,
  companies,
}: ApproveCustomerProps) {
  const router = useRouter();
  const supabase = createClient();

  const [companyId, setCompanyId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleApprove() {
    if (!companyId) {
      setError("Select a company first.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    const { error: approvalError } = await supabase.rpc(
      "approve_customer",
      {
        profile_id: profileId,
        selected_company_id: companyId,
      }
    );

    setIsSubmitting(false);

    if (approvalError) {
      setError(approvalError.message);
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex min-w-72 flex-col gap-2">
      <div className="flex gap-2">
        <select
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          className="min-w-48 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Select company</option>

          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.company_name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleApprove}
          disabled={isSubmitting}
          className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Approving..." : "Approve"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}