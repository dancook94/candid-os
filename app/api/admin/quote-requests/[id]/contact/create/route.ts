import { revalidatePath } from "next/cache";

import { handleCreateWebsiteEnquiryContact } from "@/lib/quote-request/website-enquiry-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const response = await handleCreateWebsiteEnquiryContact(request, id);

  if (response.ok) {
    revalidatePath(`/admin/quote-requests/${id}`);
  }

  return response;
}
