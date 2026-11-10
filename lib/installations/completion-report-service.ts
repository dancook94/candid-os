import type { SupabaseClient } from "@supabase/supabase-js";

import { readCompletionChecklist } from "@/lib/installations/completion";
import {
  buildInstallationReportPath,
  checklistReportValues,
  formatInstallationReportReference,
  hasOfficialInstallationSignOff,
  OFFICIAL_REPORT_SIGN_OFF_REQUIRED,
  quoteReferenceLabel,
  selectInstallationReportPhotos,
} from "@/lib/installations/completion-report";
import {
  buildInstallationCompletionReportPdf,
  type CompletionReportImage,
  type CompletionReportPdfInput,
} from "@/lib/installations/completion-report-pdf";
import { INSTALLATION_FILES_BUCKET } from "@/lib/installations/constants";
import { assertReportPhotographCount } from "@/lib/installations/report-image";
import { isOutstandingInstallationSnag } from "@/lib/installations/job-signal";
import { PROJECT_STATUS_LABELS, VISIT_STATUS_LABELS, formatLondonWhen } from "@/lib/installations/labels";

type PhotoRow = {
  id: string;
  phase: string;
  file_name: string | null;
  storage_path: string | null;
  captured_at: string | null;
  snag_id: string | null;
  snag_photo_role: string | null;
  uploaded_by_profile_id: string | null;
};

const PHASE_LABELS: Record<string, string> = {
  before: "Before installation",
  during: "During installation",
  after: "After installation",
};

const SNAG_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Won't fix",
};

export async function buildVisitCompletionReport(input: {
  admin: SupabaseClient;
  visitId: string;
  selectedPhotoIds: readonly string[] | null;
  versionNumber: number;
  reportReference: string;
  generatedAt?: Date;
}) {
  const loaded = await loadVisitReportSource(input.admin, input.visitId);
  const gallery = (loaded.installation_visit_photos ?? []).filter((photo) => !photo.snag_id);
  const selected = selectInstallationReportPhotos(gallery, input.selectedPhotoIds);
  const snagPhotographs = (loaded.installation_visit_photos ?? []).filter((photo) => photo.snag_id).length;
  assertReportPhotographCount(selected.length + snagPhotographs);
  const selectedIds = new Set(selected.map((photo) => photo.id));
  const names = await profileNames(input.admin, collectProfileIds(loaded));
  const generatedAt = input.generatedAt ?? new Date();
  const pdfInput = await toPdfInput({
    admin: input.admin,
    loaded,
    selected,
    names,
    versionNumber: input.versionNumber,
    reportReference: input.reportReference,
    generatedAt,
  });
  const bytes = await buildInstallationCompletionReportPdf(pdfInput);
  return {
    bytes,
    includedPhotoIds: [...selectedIds],
    storagePath: buildInstallationReportPath(input.visitId, input.versionNumber, input.reportReference),
  };
}

export async function assertVisitReadyForOfficialReport(admin: SupabaseClient, visitId: string) {
  const { data, error } = await admin
    .from("installation_sign_offs")
    .select("customer_name, customer_attendance, decline_reason, signature_storage_path, checklist")
    .eq("installation_visit_id", visitId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const signOff = data as {
    customer_name?: string | null;
    customer_attendance?: string | null;
    decline_reason?: string | null;
    signature_storage_path?: string | null;
    checklist?: unknown;
  } | null;
  const checklist = readCompletionChecklist(signOff?.checklist);
  const official = hasOfficialInstallationSignOff({
    customerAttendance: signOff?.customer_attendance,
    customerName: signOff?.customer_name,
    declineReason: signOff?.decline_reason,
    signatureStoragePath: signOff?.signature_storage_path,
    checklist,
  });

  if (!official) {
    throw new Error(OFFICIAL_REPORT_SIGN_OFF_REQUIRED);
  }
}

export function reportReferenceFromPreview(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as { version_number?: unknown; report_reference?: unknown };
  const versionNumber = Number(record.version_number);
  const reportReference = typeof record.report_reference === "string" ? record.report_reference : "";
  if (!Number.isInteger(versionNumber) || versionNumber < 1 || !reportReference) return null;
  return { versionNumber, reportReference };
}

async function loadVisitReportSource(admin: SupabaseClient, visitId: string) {
  const { data, error } = await admin
    .from("installation_visits")
    .select(`
      id, visit_number, title, status, purpose, scheduled_start_at,
      site_address_line_1, site_address_line_2, site_city, site_county, site_postcode,
      access_instructions, internal_notes, completion_notes,
      on_site_contact_name, on_site_contact_phone,
      installation_project_id,
      installation_projects(
        id, title, status, description,
        companies(company_name),
        jobs(job_reference, project_name),
        quotes(quote_number)
      ),
      installation_visit_assignments(profile_id, profiles!installation_visit_assignments_profile_id_fkey(full_name)),
      installation_visit_photos(id, phase, file_name, storage_path, captured_at, snag_id, snag_photo_role, uploaded_by_profile_id),
      installation_snag_items(id, description, status, assigned_to_profile_id, resolution_notes),
      installation_sign_offs(customer_name, signed_at, customer_attendance, decline_reason, signature_storage_path, captured_by_profile_id, checklist)
    `)
    .eq("id", visitId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Installation visit not found.");
  return data as ReportSource;
}

type ReportSource = {
  id: string;
  visit_number: number;
  title: string | null;
  status: string;
  purpose: string | null;
  scheduled_start_at: string | null;
  site_address_line_1: string | null;
  site_address_line_2: string | null;
  site_city: string | null;
  site_county: string | null;
  site_postcode: string | null;
  access_instructions: string | null;
  internal_notes: string | null;
  completion_notes: string | null;
  on_site_contact_name: string | null;
  on_site_contact_phone: string | null;
  installation_projects: {
    title?: string | null;
    status?: string | null;
    description?: string | null;
    companies?: { company_name?: string | null } | { company_name?: string | null }[] | null;
    jobs?: { job_reference?: string | null; project_name?: string | null } | { job_reference?: string | null; project_name?: string | null }[] | null;
    quotes?: { quote_number?: number | string | null } | { quote_number?: number | string | null }[] | null;
  } | {
    title?: string | null;
    status?: string | null;
    description?: string | null;
    companies?: { company_name?: string | null } | { company_name?: string | null }[] | null;
    jobs?: { job_reference?: string | null; project_name?: string | null } | { job_reference?: string | null; project_name?: string | null }[] | null;
    quotes?: { quote_number?: number | string | null } | { quote_number?: number | string | null }[] | null;
  }[] | null;
  installation_visit_assignments: { profile_id?: string; profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null }[] | null;
  installation_visit_photos: PhotoRow[] | null;
  installation_snag_items: {
    id: string;
    description: string | null;
    status: string;
    assigned_to_profile_id: string | null;
    resolution_notes: string | null;
  }[] | null;
  installation_sign_offs: {
    customer_name?: string | null;
    signed_at?: string | null;
    customer_attendance?: string | null;
    decline_reason?: string | null;
    signature_storage_path?: string | null;
    captured_by_profile_id?: string | null;
    checklist?: unknown;
  } | {
    customer_name?: string | null;
    signed_at?: string | null;
    customer_attendance?: string | null;
    decline_reason?: string | null;
    signature_storage_path?: string | null;
    captured_by_profile_id?: string | null;
    checklist?: unknown;
  }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function collectProfileIds(loaded: ReportSource) {
  const ids = new Set<string>();
  for (const photo of loaded.installation_visit_photos ?? []) {
    if (photo.uploaded_by_profile_id) ids.add(photo.uploaded_by_profile_id);
  }
  for (const snag of loaded.installation_snag_items ?? []) {
    if (snag.assigned_to_profile_id) ids.add(snag.assigned_to_profile_id);
  }
  const signOff = one(loaded.installation_sign_offs);
  if (signOff?.captured_by_profile_id) ids.add(signOff.captured_by_profile_id);
  return [...ids];
}

async function profileNames(admin: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await admin.from("profiles").select("id, full_name").in("id", ids);
  return new Map(
    (data ?? []).map((row) => {
      const profile = row as { id: string; full_name: string | null };
      return [profile.id, profile.full_name || "Staff"] as const;
    })
  );
}

async function downloadImage(admin: SupabaseClient, path: string | null, caption: string, id: string): Promise<CompletionReportImage> {
  const label = caption.split(" · ")[0]?.trim() || "This photograph";
  if (!path) {
    throw new Error(`${label} could not be loaded for the completion report.`);
  }
  const { data, error } = await admin.storage.from(INSTALLATION_FILES_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`${label} could not be loaded for the completion report.`);
  }
  return { id, caption, bytes: new Uint8Array(await data.arrayBuffer()) };
}

async function toPdfInput(input: {
  admin: SupabaseClient;
  loaded: ReportSource;
  selected: PhotoRow[];
  names: Map<string, string>;
  versionNumber: number;
  reportReference: string;
  generatedAt: Date;
}): Promise<CompletionReportPdfInput> {
  const project = one(input.loaded.installation_projects);
  const company = one(project?.companies);
  const job = one(project?.jobs);
  const quote = one(project?.quotes);
  const quoteNumber = typeof quote?.quote_number === "number"
    ? quote.quote_number
    : typeof quote?.quote_number === "string" && quote.quote_number.trim() !== "" && Number.isFinite(Number(quote.quote_number))
      ? Number(quote.quote_number)
      : null;
  const signOff = one(input.loaded.installation_sign_offs);
  const checklist = checklistReportValues(readCompletionChecklist(signOff?.checklist));
  const address = [
    input.loaded.site_address_line_1,
    input.loaded.site_address_line_2,
    input.loaded.site_city,
    input.loaded.site_county,
    input.loaded.site_postcode,
  ].filter(Boolean).join(", ");
  const workDetails = [
    ["Installation", project?.title || input.loaded.title],
    ["Job", job?.project_name],
    ["Description", project?.description],
    ["Purpose", input.loaded.purpose],
    ["Site contact", [input.loaded.on_site_contact_name, input.loaded.on_site_contact_phone].filter(Boolean).join(" · ")],
    ["Instructions", input.loaded.access_instructions],
    ["Site notes", input.loaded.internal_notes],
    ["Completion notes", input.loaded.completion_notes],
  ]
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([label, value]) => ({ label, value }));

  const photos = input.loaded.installation_visit_photos ?? [];
  const snagPhotos = photos.filter((photo) => photo.snag_id);
  const snags = [];
  for (const snag of input.loaded.installation_snag_items ?? []) {
    const issue = await imagesFor(input.admin, snagPhotos.filter((photo) => photo.snag_id === snag.id && photo.snag_photo_role === "issue"), input.names);
    const resolution = await imagesFor(input.admin, snagPhotos.filter((photo) => photo.snag_id === snag.id && photo.snag_photo_role === "resolution"), input.names);
    snags.push({
      description: snag.description || "Snag",
      statusLabel: SNAG_LABELS[snag.status] || snag.status,
      outstanding: isOutstandingInstallationSnag(snag.status),
      assignee: snag.assigned_to_profile_id ? input.names.get(snag.assigned_to_profile_id) || "Staff" : null,
      resolutionNotes: snag.resolution_notes,
      issuePhotos: issue,
      resolutionPhotos: resolution,
    });
  }

  const grouped = [];
  for (const phase of ["before", "during", "after"]) {
    const images = await imagesFor(input.admin, input.selected.filter((photo) => photo.phase === phase), input.names);
    grouped.push({ phaseLabel: PHASE_LABELS[phase], images });
  }

  let signaturePng: Uint8Array | null = null;
  if (signOff?.customer_attendance === "present" && signOff.signature_storage_path) {
    const downloaded = await downloadImage(input.admin, signOff.signature_storage_path, "Customer signature", "signature");
    signaturePng = downloaded.bytes;
  }

  const attendance = signOff?.customer_attendance;
  const expectedReference = formatInstallationReportReference(job?.job_reference, input.loaded.visit_number, input.versionNumber);
  if (expectedReference !== input.reportReference) {
    throw new Error("Report reference does not match this visit.");
  }

  return {
    reportReference: input.reportReference,
    versionNumber: input.versionNumber,
    generatedAtLabel: formatLondonWhen(input.generatedAt.toISOString()),
    jobReference: job?.job_reference || null,
    quoteReference: quoteReferenceLabel(quoteNumber),
    companyName: company?.company_name || "Customer",
    siteAddress: address || null,
    installationDateLabel: input.loaded.scheduled_start_at ? formatLondonWhen(input.loaded.scheduled_start_at) : null,
    installers: (input.loaded.installation_visit_assignments ?? []).map((assignment) => one(assignment.profiles)?.full_name || "Installer"),
    visitStatusLabel: VISIT_STATUS_LABELS[input.loaded.status as keyof typeof VISIT_STATUS_LABELS] || input.loaded.status,
    visitTitle: input.loaded.title || "Visit",
    visitNumber: input.loaded.visit_number,
    projectStatusLabel: PROJECT_STATUS_LABELS[(project?.status || "active") as keyof typeof PROJECT_STATUS_LABELS] || project?.status || "Active",
    workDetails,
    checklist: {
      ...checklist,
      recordedBy: signOff?.captured_by_profile_id ? input.names.get(signOff.captured_by_profile_id) || "Staff" : null,
      recordedAtLabel: signOff?.signed_at ? formatLondonWhen(signOff.signed_at) : null,
    },
    snags,
    attendance: attendance === "present" || attendance === "absent" || attendance === "declined" ? attendance : null,
    customerName: signOff?.customer_name || null,
    declineReason: signOff?.decline_reason || null,
    signedAtLabel: signOff?.signed_at ? formatLondonWhen(signOff.signed_at) : null,
    signOffRecordedBy: signOff?.captured_by_profile_id ? input.names.get(signOff.captured_by_profile_id) || "Staff" : null,
    signaturePng,
    photos: grouped,
    includeQuotationAppendix: false,
  };
}

async function imagesFor(admin: SupabaseClient, photos: PhotoRow[], names: Map<string, string>) {
  const images: CompletionReportImage[] = [];
  for (const photo of photos) {
    const uploader = photo.uploaded_by_profile_id ? names.get(photo.uploaded_by_profile_id) : null;
    const caption = [photo.file_name || "Photograph", photo.captured_at ? formatLondonWhen(photo.captured_at) : null, uploader]
      .filter(Boolean)
      .join(" · ");
    images.push(await downloadImage(admin, photo.storage_path, caption, photo.id));
  }
  return images;
}

export async function uploadCompletionReport(supabase: SupabaseClient, storagePath: string, bytes: Uint8Array) {
  const { error } = await supabase.storage.from(INSTALLATION_FILES_BUCKET).upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw new Error(error.message);
}

export async function removeUnregisteredReport(supabase: SupabaseClient, storagePath: string) {
  await supabase.storage.from(INSTALLATION_FILES_BUCKET).remove([storagePath]);
}
