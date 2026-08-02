import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveContactPortalStatus,
  type ContactPortalStatus,
} from "@/lib/crm/contact-portal-status";

/** FK: contacts.profile_id -> profiles.id */
export const CONTACTS_PROFILE_ID_FKEY = "contacts_profile_id_fkey";

/** FK: contacts.created_by -> profiles.id */
export const CONTACTS_CREATED_BY_FKEY = "contacts_created_by_fkey";

export type ContactRecord = {
  id: string;
  company_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  notes: string | null;
  is_primary: boolean;
  is_active: boolean;
  profile_id: string | null;
  invited_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactListRow = {
  id: string;
  company_id: string;
  company_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  notes: string | null;
  is_primary: boolean;
  is_active: boolean;
  profile_id: string | null;
  invited_at: string | null;
  portal_status: ContactPortalStatus;
  profile_account_status: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeContactEmail(email: string | null | undefined) {
  const trimmed = email?.trim().toLowerCase() ?? "";
  return trimmed || null;
}

type ContactPortalProfile = {
  id: string;
  full_name: string | null;
  account_status: string;
  user_role: string;
  company_id: string | null;
};

type ContactQueryRow = ContactRecord & {
  companies: { company_name: string } | { company_name: string }[] | null;
  portal_profile:
    | ContactPortalProfile
    | ContactPortalProfile[]
    | null;
};

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapContactRow(row: ContactQueryRow): ContactListRow {
  const company = unwrapRelation(row.companies);
  const profile = unwrapRelation(row.portal_profile);
  const profileAccountStatus = profile?.account_status ?? null;

  return {
    id: row.id,
    company_id: row.company_id,
    company_name: company?.company_name ?? "Unknown company",
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    job_title: row.job_title,
    notes: row.notes,
    is_primary: row.is_primary,
    is_active: row.is_active,
    profile_id: row.profile_id,
    invited_at: row.invited_at,
    portal_status: resolveContactPortalStatus(
      row.profile_id,
      profileAccountStatus,
      row.invited_at
    ),
    profile_account_status: profileAccountStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const CONTACT_LIST_SELECT = `
  id,
  company_id,
  full_name,
  email,
  phone,
  job_title,
  notes,
  is_primary,
  is_active,
  profile_id,
  invited_at,
  created_at,
  updated_at,
  companies ( company_name ),
  portal_profile:profiles!${CONTACTS_PROFILE_ID_FKEY} (
    id,
    full_name,
    account_status,
    user_role,
    company_id
  )
`;

export async function fetchContactsList(
  supabase: SupabaseClient,
  options: { companyId?: string | null } = {}
) {
  let query = supabase
    .from("contacts")
    .select(CONTACT_LIST_SELECT)
    .order("full_name", { ascending: true });

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query;

  if (error) {
    return {
      contacts: [] as ContactListRow[],
      queryError: error.message,
    };
  }

  return {
    contacts: ((data ?? []) as ContactQueryRow[]).map(mapContactRow),
    queryError: null as string | null,
  };
}

export async function fetchContactById(
  supabase: SupabaseClient,
  contactId: string
) {
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_LIST_SELECT)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    return {
      contact: null as ContactListRow | null,
      queryError: error.message,
    };
  }

  if (!data) {
    return {
      contact: null as ContactListRow | null,
      queryError: "Contact not found.",
    };
  }

  return {
    contact: mapContactRow(data as ContactQueryRow),
    queryError: null as string | null,
  };
}

export async function findDuplicateContactEmail(
  supabase: SupabaseClient,
  companyId: string,
  email: string,
  excludeContactId?: string
) {
  const normalised = normalizeContactEmail(email);

  if (!normalised) {
    return null;
  }

  let query = supabase
    .from("contacts")
    .select("id, full_name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .eq("email", normalised);

  if (excludeContactId) {
    query = query.neq("id", excludeContactId);
  }

  const { data } = await query.maybeSingle();

  return data ?? null;
}
