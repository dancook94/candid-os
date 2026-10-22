import {
  websiteArtworkPreflight,
  withWebsiteArtworkCors,
} from "@/lib/integrations/website-artwork-cors";
import { handleWebsiteArtworkChunk } from "@/lib/quote-request/website-artwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS(request: Request) {
  return websiteArtworkPreflight(request);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await context.params;
  const response = await handleWebsiteArtworkChunk(request, id, fileId);
  return withWebsiteArtworkCors(request, response);
}
