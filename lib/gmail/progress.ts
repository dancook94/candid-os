export function gmailDiscoveryContinuation(status: string | null) {
  switch (status) {
    case "running":
      return "Running. The background scan continues every 15 minutes. This page can be closed.";
    case "paused":
      return "Paused. The background scan waits until you resume it.";
    case "completed":
      return "This discovery run is complete and is kept. Ongoing discovery is not enabled. Another date range starts a separate run.";
    case "failed":
      return "This discovery needs attention before the background scan can continue.";
    default:
      return "Not started. Start discovery once and the background scan continues until this date range is finished.";
  }
}
