import { handleRenewWebsiteArtwork } from "@/lib/quote-request/website-artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await context.params;
  return handleRenewWebsiteArtwork(request, id, fileId);
}
