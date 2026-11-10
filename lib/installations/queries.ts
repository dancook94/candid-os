import type { SupabaseClient } from "@supabase/supabase-js";

import { INSTALLATION_FILES_BUCKET } from "@/lib/installations/constants";
import { isOutstandingInstallationSnag } from "@/lib/installations/job-signal";
import { londonDateKey } from "@/lib/installations/labels";

type NameRow = { full_name?: string | null };
type CompanyRow = { company_name?: string | null };
type JobRow = { job_reference?: string | null; project_name?: string | null };
type QuoteRow = { quote_number?: number | null };

export type InstallationAssignee = {
  profileId: string;
  name: string;
};

export type InstallationSnag = {
  id: string;
  description: string;
  status: string;
  assignedToProfileId: string | null;
  resolutionNotes: string | null;
  issuePhotos: InstallationFile[];
  resolutionPhotos: InstallationFile[];
};

export type InstallationFile = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
};

export type InstallationVisitRecord = {
  id: string;
  visitNumber: number;
  title: string;
  status: string;
  purpose: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  siteLabel: string | null;
  siteAddressLine1: string | null;
  siteAddressLine2: string | null;
  siteCity: string | null;
  siteCounty: string | null;
  sitePostcode: string | null;
  siteCountry: string | null;
  sitePhone: string | null;
  siteRecipientName: string | null;
  accessInstructions: string | null;
  onSiteContactName: string | null;
  onSiteContactPhone: string | null;
  internalNotes: string | null;
  completionNotes: string | null;
  assignees: InstallationAssignee[];
  openSnagCount: number;
  snags: InstallationSnag[];
  photos: InstallationFile[];
  documents: InstallationFile[];
  signOffName: string | null;
  signOffAt: string | null;
};

export type InstallationProjectRecord = {
  id: string;
  title: string;
  status: string;
  description: string | null;
  companyId: string;
  companyName: string;
  jobId: string | null;
  jobReference: string | null;
  jobName: string | null;
  quoteId: string | null;
  quoteNumber: number | null;
  artwork: InstallationArtwork[];
  visits: InstallationVisitRecord[];
};

export type InstallationArtwork = {
  id: string;
  name: string;
};

export type InstallerOption = {
  id: string;
  name: string;
  role: string;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function toInstallationFile(photo: {
  id: string;
  name: string;
  kind: string;
  url: string | null;
}): InstallationFile {
  return {
    id: photo.id,
    name: photo.name,
    kind: photo.kind,
    url: photo.url,
  };
}

async function signedUrl(supabase: SupabaseClient, path: string | null) {
  if (!path) {
    return null;
  }

  const { data } = await supabase.storage
    .from(INSTALLATION_FILES_BUCKET)
    .createSignedUrl(path, 60 * 60);

  return data?.signedUrl ?? null;
}

const VISIT_SELECT = `
  id, visit_number, title, status, purpose,
  scheduled_start_at, scheduled_end_at,
  site_label, site_address_line_1, site_address_line_2, site_city, site_county,
  site_postcode, site_country, site_phone, site_recipient_name,
  access_instructions, on_site_contact_name, on_site_contact_phone,
  internal_notes, completion_notes,
  installation_visit_assignments(
    profile_id,
    profiles!installation_visit_assignments_profile_id_fkey(full_name)
  ),
  installation_snag_items(id, description, status, assigned_to_profile_id, resolution_notes)
`;

const PROJECT_LIST_SELECT = `
  id, title, status, description, company_id, job_id, quote_id, updated_at,
  companies(company_name),
  jobs(job_reference, project_name),
  quotes(quote_number),
  installation_visits(${VISIT_SELECT})
`;

const PROJECT_DETAIL_SELECT = `
  id, title, status, description, company_id, job_id, quote_id,
  companies(company_name),
  jobs(job_reference, project_name),
  quotes(quote_number),
  installation_visits(
    ${VISIT_SELECT},
    installation_visit_photos(id, phase, file_name, storage_path, snag_id, snag_photo_role),
    installation_visit_documents(id, document_kind, file_name, storage_path),
    installation_sign_offs(customer_name, signed_at)
  )
`;

async function mapVisit(
  row: Record<string, unknown>,
  supabase: SupabaseClient,
  includeFiles: boolean
): Promise<InstallationVisitRecord> {
  const assignments = Array.isArray(row.installation_visit_assignments)
    ? row.installation_visit_assignments
    : [];
  const snags = Array.isArray(row.installation_snag_items) ? row.installation_snag_items : [];
  const photos = includeFiles && Array.isArray(row.installation_visit_photos)
    ? row.installation_visit_photos
    : [];
  const documents = includeFiles && Array.isArray(row.installation_visit_documents)
    ? row.installation_visit_documents
    : [];
  const signOff = one(
    row.installation_sign_offs as
      | { customer_name?: string; signed_at?: string }
      | { customer_name?: string; signed_at?: string }[]
      | null
  );
  const mappedPhotos = await Promise.all(
    photos.map(async (photo) => {
      const record = photo as {
        id?: string;
        phase?: string;
        file_name?: string;
        storage_path?: string;
        snag_id?: string | null;
        snag_photo_role?: string | null;
      };
      return {
        id: String(record.id),
        name: record.file_name || "Photo",
        kind: record.phase || "during",
        url: await signedUrl(supabase, record.storage_path || null),
        snagId: record.snag_id || null,
        role: record.snag_photo_role || null,
      };
    })
  );

  return {
    id: String(row.id),
    visitNumber: Number(row.visit_number) || 0,
    title: text(row.title) || "Visit",
    status: text(row.status) || "unscheduled",
    purpose: text(row.purpose),
    scheduledStartAt: text(row.scheduled_start_at),
    scheduledEndAt: text(row.scheduled_end_at),
    siteLabel: text(row.site_label),
    siteAddressLine1: text(row.site_address_line_1),
    siteAddressLine2: text(row.site_address_line_2),
    siteCity: text(row.site_city),
    siteCounty: text(row.site_county),
    sitePostcode: text(row.site_postcode),
    siteCountry: text(row.site_country),
    sitePhone: text(row.site_phone),
    siteRecipientName: text(row.site_recipient_name),
    accessInstructions: text(row.access_instructions),
    onSiteContactName: text(row.on_site_contact_name),
    onSiteContactPhone: text(row.on_site_contact_phone),
    internalNotes: text(row.internal_notes),
    completionNotes: text(row.completion_notes),
    assignees: assignments.map((assignment) => {
      const record = assignment as { profile_id?: string; profiles?: NameRow | NameRow[] | null };
      const profile = one(record.profiles);
      return {
        profileId: String(record.profile_id),
        name: profile?.full_name || "Installer",
      };
    }),
    openSnagCount: snags.filter((snag) =>
      isOutstandingInstallationSnag((snag as { status?: string }).status)
    ).length,
    snags: snags.map((snag) => {
      const record = snag as {
        id?: string;
        description?: string;
        status?: string;
        assigned_to_profile_id?: string | null;
        resolution_notes?: string | null;
      };
      const snagId = String(record.id);
      const snagPhotos = mappedPhotos.filter((photo) => photo.snagId === snagId);
      return {
        id: snagId,
        description: record.description || "",
        status: record.status || "open",
        assignedToProfileId: record.assigned_to_profile_id || null,
        resolutionNotes: record.resolution_notes || null,
        issuePhotos: snagPhotos
          .filter((photo) => photo.role === "issue")
          .map(toInstallationFile),
        resolutionPhotos: snagPhotos
          .filter((photo) => photo.role === "resolution")
          .map(toInstallationFile),
      };
    }),
    photos: mappedPhotos.filter((photo) => !photo.snagId).map(toInstallationFile),
    documents: await Promise.all(
      documents.map(async (document) => {
        const record = document as {
          id?: string;
          document_kind?: string;
          file_name?: string;
          storage_path?: string | null;
        };
        return {
          id: String(record.id),
          name: record.file_name || "Document",
          kind: record.document_kind || "other",
          url: await signedUrl(supabase, record.storage_path || null),
        };
      })
    ),
    signOffName: signOff?.customer_name || null,
    signOffAt: text(signOff?.signed_at),
  };
}

async function mapProject(
  row: Record<string, unknown>,
  supabase: SupabaseClient,
  includeFiles: boolean,
  artwork: InstallationArtwork[] = []
): Promise<InstallationProjectRecord> {
  const company = one(row.companies as CompanyRow | CompanyRow[] | null);
  const job = one(row.jobs as JobRow | JobRow[] | null);
  const quote = one(row.quotes as QuoteRow | QuoteRow[] | null);
  const visits = Array.isArray(row.installation_visits) ? row.installation_visits : [];
  const mappedVisits = await Promise.all(
    visits.map((visit) => mapVisit(visit as Record<string, unknown>, supabase, includeFiles))
  );

  mappedVisits.sort((left, right) => left.visitNumber - right.visitNumber);

  return {
    id: String(row.id),
    title: text(row.title) || "Installation",
    status: text(row.status) || "active",
    description: text(row.description),
    companyId: String(row.company_id),
    companyName: company?.company_name || "Customer",
    jobId: text(row.job_id),
    jobReference: job?.job_reference || null,
    jobName: job?.project_name || null,
    quoteId: text(row.quote_id),
    quoteNumber: typeof quote?.quote_number === "number" ? quote.quote_number : null,
    artwork,
    visits: mappedVisits,
  };
}

export async function loadInstallationProjects(
  admin: SupabaseClient,
  reader: SupabaseClient
) {
  const { data, error } = await admin
    .from("installation_projects")
    .select(PROJECT_LIST_SELECT)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return Promise.all(
    (data ?? []).map((row) => mapProject(row as Record<string, unknown>, reader, false))
  );
}

export async function loadInstallationProject(
  admin: SupabaseClient,
  reader: SupabaseClient,
  projectId: string
) {
  const { data, error } = await admin
    .from("installation_projects")
    .select(PROJECT_DETAIL_SELECT)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const jobId = text((data as { job_id?: string | null }).job_id);
  let artwork: InstallationArtwork[] = [];
  if (jobId) {
    const { data: files } = await admin
      .from("job_files")
      .select("id, original_file_name, file_name")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    artwork = (files ?? []).map((file) => {
      const row = file as { id?: string; original_file_name?: string | null; file_name?: string | null };
      return {
        id: String(row.id),
        name: row.original_file_name || row.file_name || "Artwork",
      };
    });
  }

  return mapProject(data as Record<string, unknown>, reader, true, artwork);
}

export async function loadInstallerOptions(admin: SupabaseClient): Promise<InstallerOption[]> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, user_role")
    .eq("account_status", "approved")
    .in("user_role", ["super_admin", "admin", "production"])
    .order("full_name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((profile) => ({
    id: String(profile.id),
    name: profile.full_name || "Staff",
    role: String(profile.user_role),
  }));
}

export async function loadInstallationCompanies(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("companies")
    .select("id, company_name")
    .order("company_name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((company) => ({
    id: String(company.id),
    name: company.company_name || "Customer",
  }));
}

export function visitFallsOnDate(visit: InstallationVisitRecord, isoDate: string) {
  return londonDateKey(visit.scheduledStartAt) === isoDate;
}

export function siteSummary(visit: InstallationVisitRecord) {
  return [visit.siteCity, visit.sitePostcode].filter(Boolean).join(" ") || visit.siteLabel || "Site not set";
}

export function nextVisit(project: InstallationProjectRecord) {
  return (
    project.visits.find(
      (visit) => !["completed", "cancelled"].includes(visit.status) && visit.scheduledStartAt
    ) ||
    project.visits.find((visit) => !["completed", "cancelled"].includes(visit.status)) ||
    project.visits[0] ||
    null
  );
}
