import { decodeGmailBase64Url, type GmailMessagePart } from "@/lib/gmail/attachments";
import { sanitizeGmailError, type GmailRequestError } from "@/lib/gmail/errors";

export type GmailListedMessage = {
  id: string;
  threadId: string;
};

export type GmailDiscoveryClient = {
  listMessages(input: {
    query: string;
    pageToken: string | null;
    maxResults: number;
  }): Promise<{ messages: GmailListedMessage[]; nextPageToken: string | null }>;
  getMessage(messageId: string): Promise<{ id: string; threadId: string; payload: GmailMessagePart }>;
  getAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
};

type GmailListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
  error?: { message?: string; status?: string };
};

type GmailMessageResponse = {
  id?: string;
  threadId?: string;
  payload?: GmailMessagePart;
  error?: { message?: string };
};

type GmailAttachmentResponse = {
  data?: string;
  size?: number;
  error?: { message?: string };
};

async function gmailFetch<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok) {
    const error = new Error(
      sanitizeGmailError(new Error(payload.error?.message || "Gmail could not be read."))
    ) as GmailRequestError;
    error.status = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && /^\d+$/.test(retryAfter)) {
      error.retryAfterSeconds = Number(retryAfter);
    }
    throw error;
  }

  return payload;
}

export function createGmailApiClient(accessToken: string): GmailDiscoveryClient {
  return {
    async listMessages({ query, pageToken, maxResults }) {
      const params = new URLSearchParams({
        q: query,
        maxResults: String(maxResults),
      });

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const payload = await gmailFetch<GmailListResponse>(
        accessToken,
        `messages?${params.toString()}`
      );

      return {
        messages: (payload.messages ?? []).flatMap((message) =>
          message.id
            ? [{ id: message.id, threadId: message.threadId || message.id }]
            : []
        ),
        nextPageToken: payload.nextPageToken ?? null,
      };
    },

    async getMessage(messageId) {
      const payload = await gmailFetch<GmailMessageResponse>(
        accessToken,
        `messages/${encodeURIComponent(messageId)}?format=full`
      );

      if (!payload.id || !payload.payload) {
        throw new Error("A Gmail message could not be read.");
      }

      return {
        id: payload.id,
        threadId: payload.threadId || payload.id,
        payload: payload.payload,
      };
    },

    async getAttachment(messageId, attachmentId) {
      const payload = await gmailFetch<GmailAttachmentResponse>(
        accessToken,
        `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
      );

      if (!payload.data) {
        throw new Error("A Gmail attachment could not be downloaded.");
      }

      return new Uint8Array(decodeGmailBase64Url(payload.data));
    },
  };
}
