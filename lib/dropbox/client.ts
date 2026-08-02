import { DROPBOX_DEFAULT_ROOT_FOLDER } from "@/lib/dropbox/oauth";

type DropboxTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

type DropboxApiError = {
  error_summary?: string;
  error?: unknown;
};

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

export function isDropboxConfigured() {
  return Boolean(
    process.env.DROPBOX_APP_KEY?.trim() &&
      process.env.DROPBOX_APP_SECRET?.trim() &&
      process.env.DROPBOX_REFRESH_TOKEN?.trim() &&
      (process.env.DROPBOX_ROOT_FOLDER?.trim() || DROPBOX_DEFAULT_ROOT_FOLDER)
  );
}

export function getDropboxRootFolder() {
  const root = process.env.DROPBOX_ROOT_FOLDER?.trim() || DROPBOX_DEFAULT_ROOT_FOLDER;
  return root.startsWith("/") ? root.replace(/\/+$/, "") : `/${root.replace(/\/+$/, "")}`;
}

export class DropboxError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "DropboxError";
    this.status = status;
  }
}

async function parseDropboxError(response: Response) {
  const text = await response.text();

  if (!text) {
    return response.statusText;
  }

  try {
    const payload = JSON.parse(text) as DropboxApiError;
    return payload.error_summary ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function getDropboxAccessToken(): Promise<string> {
  if (!isDropboxConfigured()) {
    throw new DropboxError("Dropbox integration is not configured.", 503);
  }

  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt > now + 60_000) {
    return cachedAccessToken;
  }

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN!.trim(),
      client_id: process.env.DROPBOX_APP_KEY!.trim(),
      client_secret: process.env.DROPBOX_APP_SECRET!.trim(),
    }),
  });

  if (!response.ok) {
    const message = await parseDropboxError(response);
    throw new DropboxError(
      `Dropbox authentication failed: ${message}`,
      response.status === 401 ? 503 : 502
    );
  }

  const payload = (await response.json()) as DropboxTokenResponse;
  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiresAt = now + payload.expires_in * 1000;

  return payload.access_token;
}

export async function dropboxApiRequest<T>(
  path: string,
  {
    body,
    contentEndpoint = false,
  }: {
    body?: unknown;
    contentEndpoint?: boolean;
  } = {}
): Promise<T> {
  const accessToken = await getDropboxAccessToken();
  const host = contentEndpoint
    ? "https://content.dropboxapi.com"
    : "https://api.dropboxapi.com";

  const response = await fetch(`${host}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? "null" : JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await parseDropboxError(response);
    throw new DropboxError(message, response.status);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export async function dropboxContentUpload<T>(
  path: string,
  {
    arg,
    body,
    contentType = "application/octet-stream",
  }: {
    arg: Record<string, unknown>;
    body: ArrayBuffer | Buffer | Uint8Array;
    contentType?: string;
  }
): Promise<T> {
  const accessToken = await getDropboxAccessToken();
  const payload =
    body instanceof Buffer ? body : Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body);

  const response = await fetch(`https://content.dropboxapi.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
      "Dropbox-API-Arg": JSON.stringify(arg),
    },
    body: payload,
  });

  if (!response.ok) {
    const message = await parseDropboxError(response);
    throw new DropboxError(message, response.status);
  }

  return (await response.json()) as T;
}

export type DropboxFileMetadata = {
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  rev: string;
  size: number;
  content_hash?: string;
  client_modified?: string;
  server_modified?: string;
};

export function extractDropboxFileMetadata(
  response: DropboxFileMetadata | { metadata?: DropboxFileMetadata | null }
): DropboxFileMetadata {
  if (
    response &&
    typeof response === "object" &&
    "metadata" in response &&
    response.metadata &&
    typeof response.metadata.id === "string"
  ) {
    return response.metadata;
  }

  if (
    response &&
    typeof response === "object" &&
    "id" in response &&
    typeof response.id === "string" &&
    "path_lower" in response &&
    typeof response.path_lower === "string"
  ) {
    return response as DropboxFileMetadata;
  }

  throw new DropboxError("Dropbox did not return file metadata.", 502);
}

export type DropboxFolderMetadata = {
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
};

export async function getDropboxMetadata(path: string) {
  return dropboxApiRequest<{ metadata: DropboxFileMetadata | DropboxFolderMetadata }>(
    "/2/files/get_metadata",
    {
      body: {
        path,
        include_media_info: false,
        include_deleted: false,
      },
    }
  );
}

export async function createDropboxFolder(path: string) {
  try {
    return await dropboxApiRequest<{ metadata: DropboxFolderMetadata }>(
      "/2/files/create_folder_v2",
      {
        body: {
          path,
          autorename: false,
        },
      }
    );
  } catch (error) {
    if (
      error instanceof DropboxError &&
      /path\/conflict\/folder/.test(error.message)
    ) {
      const existing = await getDropboxMetadata(path);
      return { metadata: existing.metadata as DropboxFolderMetadata };
    }

    throw error;
  }
}

export async function downloadDropboxFile(path: string) {
  const accessToken = await getDropboxAccessToken();
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });

  if (!response.ok) {
    const message = await parseDropboxError(response);
    throw new DropboxError(message, response.status);
  }

  const fileName =
    response.headers
      .get("dropbox-api-result")
      ?.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? "download";

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    buffer,
    fileName,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
