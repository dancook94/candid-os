"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyAddressRecord } from "@/lib/customer-settings/addresses";
import type { CustomerSettingsPayload } from "@/lib/customer-settings/load-settings";
import {
  ADMIN_LOCKED_FIELD_HINT,
  NOTIFICATION_PREFERENCE_KEYS,
} from "@/lib/customer-settings/permissions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type SettingsTab =
  | "profile"
  | "company"
  | "addresses"
  | "notifications"
  | "security";

const tabs: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "My profile" },
  { id: "company", label: "Company" },
  { id: "addresses", label: "Addresses" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security" },
];

const notificationLabels: Record<(typeof NOTIFICATION_PREFERENCE_KEYS)[number], string> =
  {
    quote_received: "Quote received",
    quote_reminder: "Quote reminders",
    artwork_approval_required: "Artwork approval required",
    job_started: "Job started",
    job_ready: "Job ready",
    job_dispatched: "Job dispatched",
    invoice_available: "Invoice available",
    marketing: "Marketing updates",
  };

type CustomerSettingsPanelProps = {
  initialData: CustomerSettingsPayload;
};

function LockedField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} disabled readOnly />
      <p className="text-xs text-muted-foreground">{ADMIN_LOCKED_FIELD_HINT}</p>
    </div>
  );
}

export function CustomerSettingsPanel({ initialData }: CustomerSettingsPanelProps) {
  const router = useRouter();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [fullName, setFullName] = useState(data.contact?.full_name ?? "");
  const [jobTitle, setJobTitle] = useState(data.contact?.job_title ?? "");
  const [phone, setPhone] = useState(data.contact?.phone ?? "");

  const [tradingName, setTradingName] = useState(data.company.trading_name ?? "");
  const [accountsEmail, setAccountsEmail] = useState(
    data.company.accounts_email ?? ""
  );
  const [companyPhone, setCompanyPhone] = useState(data.company.phone ?? "");
  const [website, setWebsite] = useState(data.company.website ?? "");

  const [preferences, setPreferences] = useState(data.notifications.preferences);

  const emptyAddressForm = {
    label: "",
    recipientName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    county: "",
    postcode: "",
    country: "GB",
    phone: "",
    deliveryInstructions: "",
    isDefaultDelivery: false,
    isDefaultBilling: false,
  };

  const [newAddress, setNewAddress] = useState(emptyAddressForm);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState(emptyAddressForm);
  const [editAddressUpdatedAt, setEditAddressUpdatedAt] = useState<string | null>(
    null
  );

  const billingAddress = useMemo(
    () => data.addresses.addresses.find((address) => address.is_default_billing),
    [data.addresses.addresses]
  );

  async function reloadSettings() {
    const response = await fetch("/api/customer/settings");
    const payload = (await response.json()) as CustomerSettingsPayload & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to refresh settings.");
    }

    setData(payload);
    setFullName(payload.contact?.full_name ?? "");
    setJobTitle(payload.contact?.job_title ?? "");
    setPhone(payload.contact?.phone ?? "");
    setTradingName(payload.company.trading_name ?? "");
    setAccountsEmail(payload.company.accounts_email ?? "");
    setCompanyPhone(payload.company.phone ?? "");
    setWebsite(payload.company.website ?? "");
    setPreferences(payload.notifications.preferences);
    router.refresh();
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/customer/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          jobTitle,
          phone,
          updatedAt: data.contact?.updated_at ?? null,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save profile.");
        return;
      }

      setSuccess(payload.message ?? "Profile updated.");
      await reloadSettings();
    } catch {
      setError("Unable to save profile.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCompanySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/customer/settings/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradingName,
          accountsEmail,
          phone: companyPhone,
          website,
          updatedAt: data.company.updated_at,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save company details.");
        return;
      }

      setSuccess(payload.message ?? "Company details updated.");
      await reloadSettings();
    } catch {
      setError("Unable to save company details.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleNotificationsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/customer/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...preferences,
          updatedAt: data.notifications.updatedAt,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save notification preferences.");
        return;
      }

      setSuccess(payload.message ?? "Notification preferences updated.");
      await reloadSettings();
    } catch {
      setError("Unable to save notification preferences.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditingAddress(address: CompanyAddressRecord) {
    setEditingAddressId(address.id);
    setEditAddress({
      label: address.label ?? "",
      recipientName: address.recipient_name ?? "",
      addressLine1: address.address_line_1,
      addressLine2: address.address_line_2 ?? "",
      city: address.city ?? "",
      county: address.county ?? "",
      postcode: address.postcode,
      country: address.country,
      phone: address.phone ?? "",
      deliveryInstructions: address.delivery_instructions ?? "",
      isDefaultDelivery: address.is_default_delivery,
      isDefaultBilling: address.is_default_billing,
    });
    setEditAddressUpdatedAt(address.updated_at);
    setError("");
    setSuccess("");
  }

  function cancelEditingAddress() {
    setEditingAddressId(null);
    setEditAddress(emptyAddressForm);
    setEditAddressUpdatedAt(null);
  }

  async function handleUpdateAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingAddressId) {
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/customer/settings/addresses/${editingAddressId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: editAddress.label,
            recipientName: editAddress.recipientName,
            addressLine1: editAddress.addressLine1,
            addressLine2: editAddress.addressLine2,
            city: editAddress.city,
            county: editAddress.county,
            postcode: editAddress.postcode,
            country: editAddress.country,
            phone: editAddress.phone,
            deliveryInstructions: editAddress.deliveryInstructions,
            isDefaultDelivery: editAddress.isDefaultDelivery,
            isDefaultBilling: editAddress.isDefaultBilling,
            updatedAt: editAddressUpdatedAt,
          }),
        }
      );

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to update address.");
        return;
      }

      setSuccess(payload.message ?? "Address updated.");
      cancelEditingAddress();
      await reloadSettings();
    } catch {
      setError("Unable to update address.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeactivateAddress(addressId: string) {
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/customer/settings/addresses/${addressId}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to remove address.");
        return;
      }

      setSuccess(payload.message ?? "Address removed.");
      if (editingAddressId === addressId) {
        cancelEditingAddress();
      }
      await reloadSettings();
    } catch {
      setError("Unable to remove address.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/customer/settings/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newAddress.label,
          recipientName: newAddress.recipientName,
          addressLine1: newAddress.addressLine1,
          addressLine2: newAddress.addressLine2,
          city: newAddress.city,
          county: newAddress.county,
          postcode: newAddress.postcode,
          country: newAddress.country,
          phone: newAddress.phone,
          deliveryInstructions: newAddress.deliveryInstructions,
          isDefaultDelivery: newAddress.isDefaultDelivery,
          isDefaultBilling: newAddress.isDefaultBilling,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save address.");
        return;
      }

      setSuccess(payload.message ?? "Address saved.");
      setNewAddress(emptyAddressForm);
      await reloadSettings();
    } catch {
      setError("Unable to save address.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Settings"
        description="Manage your profile, company details, and portal preferences."
      />

      <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setError("");
              setSuccess("");
            }}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {activeTab === "profile" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>My profile</CardTitle>
              <CardDescription>
                Updates here are saved to your shared CRM contact record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.contact ? (
                <form className="space-y-5" onSubmit={handleProfileSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      required
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="jobTitle">Job title</Label>
                    <Input
                      id="jobTitle"
                      value={jobTitle}
                      onChange={(event) => setJobTitle(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>

                  <LockedField label="Email" value={data.profile.loginEmail} />

                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save profile"}
                  </Button>
                </form>
              ) : (
                <EmptyState
                  title="Contact record not linked"
                  description="Your portal account is not linked to a CRM contact yet. Contact Candid Creative to complete setup."
                />
              )}
            </CardContent>
          </Card>

          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Company contacts</CardTitle>
              <CardDescription>
                Active contacts for your company. You can edit your own profile
                only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.companyContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts found.</p>
              ) : (
                data.companyContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <p className="font-medium text-foreground">
                      {contact.full_name}
                      {contact.isSelf ? " (You)" : null}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {contact.job_title || "—"}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {contact.email || "No email"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {contact.phone || "No phone"}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "company" ? (
        <Card className="portal-surface">
          <CardHeader>
            <CardTitle>Company details</CardTitle>
            <CardDescription>
              Shared company record used across admin and customer portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-5 md:grid-cols-2" onSubmit={handleCompanySubmit}>
              <LockedField
                label="Legal company name"
                value={data.company.company_name}
              />
              <div className="space-y-2">
                <Label htmlFor="tradingName">Trading name</Label>
                <Input
                  id="tradingName"
                  value={tradingName}
                  onChange={(event) => setTradingName(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <LockedField
                label="Company number"
                value={data.company.company_number ?? "—"}
              />
              <LockedField label="VAT number" value={data.company.vat_number ?? "—"} />
              <div className="space-y-2">
                <Label htmlFor="accountsEmail">Accounts email</Label>
                <Input
                  id="accountsEmail"
                  type="email"
                  value={accountsEmail}
                  onChange={(event) => setAccountsEmail(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyPhone">Phone</Label>
                <Input
                  id="companyPhone"
                  value={companyPhone}
                  onChange={(event) => setCompanyPhone(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://"
                  disabled={isSubmitting}
                />
              </div>
              <LockedField
                label="Payment terms"
                value={
                  data.company.payment_terms_days
                    ? `${data.company.payment_terms_days} days`
                    : "—"
                }
              />
              <div className="space-y-2 md:col-span-2">
                <Label>Default billing address</Label>
                <Input
                  value={
                    billingAddress
                      ? [
                          billingAddress.address_line_1,
                          billingAddress.city,
                          billingAddress.postcode,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : "No saved billing address yet"
                  }
                  disabled
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Manage billing addresses in the Addresses tab.
                </p>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save company details"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "addresses" ? (
        <div className="space-y-6">
          {!data.addresses.available ? (
            <EmptyState
              title="Saved addresses coming soon"
              description="Shared company addresses require the customer settings database migration. Once applied, addresses added here will appear in admin Company 360 and quote forms."
            />
          ) : (
            <>
              <Card className="portal-surface">
                <CardHeader>
                  <CardTitle>Saved addresses</CardTitle>
                  <CardDescription>
                    Shared delivery and billing addresses for your company.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.addresses.addresses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No saved addresses yet.
                    </p>
                  ) : (
                    data.addresses.addresses.map((address) => (
                      <div
                        key={address.id}
                        className="rounded-xl border border-border p-4"
                      >
                        {editingAddressId === address.id ? (
                          <form
                            className="grid gap-4 md:grid-cols-2"
                            onSubmit={handleUpdateAddress}
                          >
                            <div className="space-y-2">
                              <Label htmlFor={`edit-label-${address.id}`}>Label</Label>
                              <Input
                                id={`edit-label-${address.id}`}
                                value={editAddress.label}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    label: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-recipient-${address.id}`}>
                                Recipient name
                              </Label>
                              <Input
                                id={`edit-recipient-${address.id}`}
                                value={editAddress.recipientName}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    recipientName: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label htmlFor={`edit-line1-${address.id}`}>
                                Address line 1
                              </Label>
                              <Input
                                id={`edit-line1-${address.id}`}
                                value={editAddress.addressLine1}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    addressLine1: event.target.value,
                                  }))
                                }
                                required
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label htmlFor={`edit-line2-${address.id}`}>
                                Address line 2
                              </Label>
                              <Input
                                id={`edit-line2-${address.id}`}
                                value={editAddress.addressLine2}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    addressLine2: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-city-${address.id}`}>City</Label>
                              <Input
                                id={`edit-city-${address.id}`}
                                value={editAddress.city}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    city: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-postcode-${address.id}`}>
                                Postcode
                              </Label>
                              <Input
                                id={`edit-postcode-${address.id}`}
                                value={editAddress.postcode}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    postcode: event.target.value,
                                  }))
                                }
                                required
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label htmlFor={`edit-instructions-${address.id}`}>
                                Delivery instructions
                              </Label>
                              <Textarea
                                id={`edit-instructions-${address.id}`}
                                value={editAddress.deliveryInstructions}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    deliveryInstructions: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={editAddress.isDefaultDelivery}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    isDefaultDelivery: event.target.checked,
                                  }))
                                }
                              />
                              Default delivery address
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={editAddress.isDefaultBilling}
                                onChange={(event) =>
                                  setEditAddress((current) => ({
                                    ...current,
                                    isDefaultBilling: event.target.checked,
                                  }))
                                }
                              />
                              Default billing address
                            </label>
                            <div className="flex flex-wrap gap-2 md:col-span-2">
                              <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Saving..." : "Save changes"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={isSubmitting}
                                onClick={cancelEditingAddress}
                              >
                                Cancel
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-foreground">
                                  {address.label || "Address"}
                                </p>
                                {address.is_default_delivery ? (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                                    Default delivery
                                  </span>
                                ) : null}
                                {address.is_default_billing ? (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                                    Default billing
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={isSubmitting}
                                  onClick={() => startEditingAddress(address)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={isSubmitting}
                                  onClick={() => handleDeactivateAddress(address.id)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {[
                                address.address_line_1,
                                address.address_line_2,
                                address.city,
                                address.postcode,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="portal-surface">
                <CardHeader>
                  <CardTitle>Add address</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreateAddress}>
                    <div className="space-y-2">
                      <Label htmlFor="addressLabel">Label</Label>
                      <Input
                        id="addressLabel"
                        value={newAddress.label}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            label: event.target.value,
                          }))
                        }
                        placeholder="Head office"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recipientName">Recipient name</Label>
                      <Input
                        id="recipientName"
                        value={newAddress.recipientName}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            recipientName: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="addressLine1">Address line 1</Label>
                      <Input
                        id="addressLine1"
                        value={newAddress.addressLine1}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            addressLine1: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="addressLine2">Address line 2</Label>
                      <Input
                        id="addressLine2"
                        value={newAddress.addressLine2}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            addressLine2: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={newAddress.city}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            city: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="postcode">Postcode</Label>
                      <Input
                        id="postcode"
                        value={newAddress.postcode}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            postcode: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="deliveryInstructions">Delivery instructions</Label>
                      <Textarea
                        id="deliveryInstructions"
                        value={newAddress.deliveryInstructions}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            deliveryInstructions: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newAddress.isDefaultDelivery}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            isDefaultDelivery: event.target.checked,
                          }))
                        }
                      />
                      Default delivery address
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newAddress.isDefaultBilling}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            isDefaultBilling: event.target.checked,
                          }))
                        }
                      />
                      Default billing address
                    </label>
                    <div className="md:col-span-2">
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Saving..." : "Save address"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "notifications" ? (
        <Card className="portal-surface">
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Email preferences for your contact record. Critical service emails
              may still be sent where required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data.notifications.available ? (
              <EmptyState
                title="Notification preferences coming soon"
                description="Apply the customer settings database migration to enable shared notification preferences."
              />
            ) : (
              <form className="space-y-4" onSubmit={handleNotificationsSubmit}>
                {NOTIFICATION_PREFERENCE_KEYS.map((key) => (
                  <label key={key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-foreground">
                      {notificationLabels[key]}
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences[key]}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                  </label>
                ))}
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save preferences"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "security" ? (
        <Card className="portal-surface">
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>
              Manage how you access the customer portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Link href="/forgot-password">
                <Button variant="outline">Change password</Button>
              </Link>
              <Button variant="outline" onClick={handleSignOut}>
                Sign out
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Sign out of other sessions will be available in a future update.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
