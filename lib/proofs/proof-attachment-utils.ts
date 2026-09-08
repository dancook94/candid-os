export type AttachResponsePayload = {
  error?: string;
  ok?: boolean;
};

/**
 * Parse an attachment/upload API response without throwing on non-JSON bodies
 * (for example Vercel 413 HTML error pages).
 */
export async function readAttachResponsePayload(
  response: Response
): Promise<AttachResponsePayload> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    if (response.status === 413) {
      return {
        error:
          "The upload was too large for the server to accept. Use a smaller file or place the artwork in Dropbox and select it from Working Files.",
      };
    }

    return {
      error: response.ok
        ? "Unexpected server response."
        : `Request failed (${response.status}).`,
    };
  }

  try {
    return (await response.json()) as AttachResponsePayload;
  } catch {
    return {
      error: response.ok
        ? "Unexpected server response."
        : `Request failed (${response.status}).`,
    };
  }
}

export function mapAttachFailureMessage(
  payload: AttachResponsePayload,
  response: Response,
  fallback: string
) {
  if (payload.error?.trim()) {
    return payload.error;
  }

  if (response.status === 413) {
    return "The upload was too large for the server to accept.";
  }

  return fallback;
}
