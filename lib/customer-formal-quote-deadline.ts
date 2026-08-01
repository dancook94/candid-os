import type { SupabaseClient } from "@supabase/supabase-js";

export type LinkedQuoteRequestRow = {
  id: string;
  requested_date: string | null;
  requested_time: string | null;
  fulfilment_method: string;
  deadline_status: string;
};

export type LinkedQuoteRequestDeadlineLoadResult = {
  approvedDeadline: string | null;
  quoteRequestId: string | null;
  loadError: string | null;
  diagnostic: string | null;
  linkedQuoteRequest: LinkedQuoteRequestRow | null;
};

function formatFulfilmentMethod(fulfilmentMethod: string) {
  return fulfilmentMethod === "collection" ? "Collection" : "Delivery";
}

function formatApprovedDeadlineDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatRequestedTime(requestedTime: string | null) {
  if (!requestedTime) {
    return null;
  }

  return requestedTime.length >= 5 ? requestedTime.slice(0, 5) : requestedTime;
}

export function formatApprovedQuoteDeadline(
  quoteRequest: Pick<
    LinkedQuoteRequestRow,
    "requested_date" | "requested_time" | "fulfilment_method" | "deadline_status"
  >
) {
  if (quoteRequest.deadline_status?.toLowerCase() !== "approved") {
    return null;
  }

  if (!quoteRequest.requested_date) {
    return null;
  }

  const formattedDate = formatApprovedDeadlineDate(quoteRequest.requested_date);
  const fulfilment = formatFulfilmentMethod(quoteRequest.fulfilment_method);
  const formattedTime = formatRequestedTime(quoteRequest.requested_time);

  if (formattedTime) {
    return `${formattedDate} at ${formattedTime} — ${fulfilment}`;
  }

  return `${formattedDate} — ${fulfilment}`;
}

export async function loadLinkedQuoteRequestDeadline(
  supabase: SupabaseClient,
  {
    quoteId,
    quoteRequestId,
  }: {
    quoteId: string;
    quoteRequestId: string | null;
  }
): Promise<LinkedQuoteRequestDeadlineLoadResult> {
  if (!quoteRequestId) {
    const diagnostic = `Quote ${quoteId} is not linked to a quote request (quotes.quote_request_id is null). Update the quote row in Supabase: UPDATE quotes SET quote_request_id = '<request-id>' WHERE id = '${quoteId}';`;

    if (process.env.NODE_ENV === "development") {
      console.warn("[approved-deadline]", diagnostic);
    }

    return {
      approvedDeadline: null,
      quoteRequestId: null,
      loadError: null,
      diagnostic,
      linkedQuoteRequest: null,
    };
  }

  const { data, error } = await supabase
    .from("quote_requests")
    .select(
      "id, requested_date, requested_time, fulfilment_method, deadline_status"
    )
    .eq("id", quoteRequestId)
    .maybeSingle();

  if (error) {
    const diagnostic = `Failed to load linked quote request ${quoteRequestId}: ${error.message}`;

    console.error("[approved-deadline]", {
      quoteId,
      quoteRequestId,
      error,
    });

    return {
      approvedDeadline: null,
      quoteRequestId,
      loadError: error.message,
      diagnostic,
      linkedQuoteRequest: null,
    };
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[approved-deadline] linked quote request", {
      quoteId,
      quoteRequestId,
      linkedQuoteRequest: data,
    });
  }

  if (!data) {
    const diagnostic = `Linked quote request ${quoteRequestId} was not found or is not visible through RLS.`;

    if (process.env.NODE_ENV === "development") {
      console.warn("[approved-deadline]", diagnostic);
    }

    return {
      approvedDeadline: null,
      quoteRequestId,
      loadError: null,
      diagnostic,
      linkedQuoteRequest: null,
    };
  }

  if (!data.requested_date) {
    return {
      approvedDeadline: null,
      quoteRequestId,
      loadError: null,
      diagnostic: `Linked quote request ${quoteRequestId} has no requested_date.`,
      linkedQuoteRequest: data,
    };
  }

  if (data.deadline_status?.toLowerCase() !== "approved") {
    return {
      approvedDeadline: null,
      quoteRequestId,
      loadError: null,
      diagnostic: `Linked quote request deadline_status is "${data.deadline_status}" (expected "approved").`,
      linkedQuoteRequest: data,
    };
  }

  return {
    approvedDeadline: formatApprovedQuoteDeadline(data),
    quoteRequestId,
    loadError: null,
    diagnostic: null,
    linkedQuoteRequest: data,
  };
}
