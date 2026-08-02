import { revalidatePath } from "next/cache";

export function revalidateQuoteWorkflowRoutes(input: {
  quoteId?: string | null;
  quoteRequestId?: string | null;
}) {
  revalidatePath("/admin");
  revalidatePath("/admin/quotes");
  revalidatePath("/admin/quote-requests");
  revalidatePath("/dashboard");
  revalidatePath("/quotes");

  if (input.quoteId) {
    revalidatePath(`/admin/quotes/${input.quoteId}`);
    revalidatePath(`/quotes/${input.quoteId}`);
  }

  if (input.quoteRequestId) {
    revalidatePath(`/admin/quote-requests/${input.quoteRequestId}`);
    revalidatePath(`/quotes/${input.quoteRequestId}`);
  }
}
