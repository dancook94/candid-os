"use client";

import Link from "next/link";

import { ResendAccountReadyButton } from "@/components/resend-account-ready-button";
import { ContactPortalStatusBadge } from "@/components/crm/contact-portal-status-badge";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CompanyPortalUser } from "@/lib/admin/customer-portal-profile";

type CompanyPortalUsersSectionProps = {
  users: CompanyPortalUser[];
  canResendAccountReadyEmail: boolean;
};

export function CompanyPortalUsersSection({
  users,
  canResendAccountReadyEmail,
}: CompanyPortalUsersSectionProps) {
  if (!canResendAccountReadyEmail) {
    return null;
  }

  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Portal users</CardTitle>
        <CardDescription>
          Approved customer portal accounts linked to this company.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        {users.length === 0 ? (
          <EmptyState
            title="No approved portal users"
            description="Approved portal accounts for this company will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Account status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.profileId}>
                    <td className="px-4 py-3.5">
                      {user.contactId ? (
                        <Link
                          href={`/admin/customers/${user.contactId}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {user.fullName || "Unnamed customer"}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">
                          {user.fullName || "Unnamed customer"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {user.email}
                    </td>
                    <td className="px-4 py-3.5">
                      <ContactPortalStatusBadge status="approved" />
                    </td>
                    <td className="px-4 py-3.5">
                      <ResendAccountReadyButton profileId={user.profileId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
