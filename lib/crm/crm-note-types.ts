export const CRM_NOTE_TYPES = [
  "note",
  "phone_call",
  "meeting",
  "site_visit",
  "email_summary",
  "internal",
] as const;

export type CrmNoteType = (typeof CRM_NOTE_TYPES)[number];

export function isCrmNoteType(value: string): value is CrmNoteType {
  return (CRM_NOTE_TYPES as readonly string[]).includes(value);
}

export function formatCrmNoteTypeLabel(noteType: CrmNoteType) {
  switch (noteType) {
    case "note":
      return "Note";
    case "phone_call":
      return "Phone call";
    case "meeting":
      return "Meeting";
    case "site_visit":
      return "Site visit";
    case "email_summary":
      return "Email summary";
    case "internal":
      return "Internal";
    default:
      return noteType;
  }
}
