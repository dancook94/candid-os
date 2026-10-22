import { handleAdminArtworkDownload } from "@/lib/quote-request/website-artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await context.params;
  return handleAdminArtworkDownload(id, fileId);
}
