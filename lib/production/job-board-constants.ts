export const JOB_PRODUCTION_BOARD_STAGES = [
  "accepted_quotes",
  "ready_to_print",
  "printed",
  "laminating",
  "finishing",
  "cutting",
  "dispatch",
  "complete_job",
  "on_hold",
] as const;

export type JobProductionBoardStage =
  (typeof JOB_PRODUCTION_BOARD_STAGES)[number];

export const JOB_PRODUCTION_BOARD_COLUMNS: JobProductionBoardStage[] = [
  "accepted_quotes",
  "ready_to_print",
  "printed",
  "laminating",
  "finishing",
  "cutting",
  "dispatch",
  "complete_job",
];

export const JOB_PRODUCTION_BOARD_STAGE_LABELS: Record<
  JobProductionBoardStage,
  string
> = {
  accepted_quotes: "Accepted Quotes",
  ready_to_print: "Ready to Print",
  printed: "Printed",
  laminating: "Laminating",
  finishing: "Finishing",
  cutting: "Cutting",
  dispatch: "Dispatch",
  complete_job: "Complete Job",
  on_hold: "On Hold",
};

export const MANUAL_JOB_BOARD_STAGES: JobProductionBoardStage[] = [
  "ready_to_print",
  "printed",
  "laminating",
  "finishing",
  "cutting",
  "dispatch",
  "complete_job",
  "on_hold",
];

export const JOB_BOARD_ACTIVITY_TYPES = {
  stageChanged: "production_board_stage_changed",
  jobReadyToPrint: "job_ready_to_print",
} as const;

export const JOB_BOARD_SELECT =
  "id, company_id, quote_id, opportunity_id, contact_id, job_reference, project_name, status, artwork_source, fulfilment_method, required_date, production_board_stage, production_board_on_hold, ready_to_print_at, ready_to_print_override_at, ready_to_print_override_reason, dropbox_folder_path, dropbox_setup_status, accepted_at, updated_at";
