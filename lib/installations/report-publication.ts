export type InstallationReportPublicationState = {
  reportId: string;
  publishedAt: string;
  publishedByProfileId: string;
  publishedByName: string | null;
};

export function isReportCurrentlyPublished(
  reportId: string,
  publication: InstallationReportPublicationState | null | undefined
) {
  return Boolean(publication && publication.reportId === reportId);
}
