import { getDropboxAccessToken, getDropboxRootFolder, isDropboxConfigured } from "@/lib/dropbox/client";
import {
  DROPBOX_DEFAULT_ROOT_FOLDER,
  getDropboxCurrentAccount,
  getDropboxOAuthConfig,
  getDropboxRedirectUri,
} from "@/lib/dropbox/oauth";

export type DropboxEnvVarStatus = {
  name: string;
  configured: boolean;
  required: boolean;
};

export type DropboxConnectionStatus = {
  appCredentialsConfigured: boolean;
  redirectUriConfigured: boolean;
  refreshTokenConfigured: boolean;
  rootFolderConfigured: boolean;
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  rootFolder: string;
  redirectUri: string | null;
  missingEnvVars: string[];
  envVars: DropboxEnvVarStatus[];
  error: string | null;
};

function getDropboxEnvVarStatuses(): DropboxEnvVarStatus[] {
  return [
    {
      name: "DROPBOX_APP_KEY",
      configured: Boolean(process.env.DROPBOX_APP_KEY?.trim()),
      required: true,
    },
    {
      name: "DROPBOX_APP_SECRET",
      configured: Boolean(process.env.DROPBOX_APP_SECRET?.trim()),
      required: true,
    },
    {
      name: "NEXT_PUBLIC_APP_URL",
      configured: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
      required: true,
    },
    {
      name: "DROPBOX_REFRESH_TOKEN",
      configured: Boolean(process.env.DROPBOX_REFRESH_TOKEN?.trim()),
      required: true,
    },
    {
      name: "DROPBOX_ROOT_FOLDER",
      configured: Boolean(process.env.DROPBOX_ROOT_FOLDER?.trim()),
      required: false,
    },
  ];
}

export function getDropboxConnectionStatusSnapshot(): Omit<
  DropboxConnectionStatus,
  "connected" | "accountEmail" | "accountName" | "error"
> {
  const envVars = getDropboxEnvVarStatuses();
  const missingEnvVars = envVars
    .filter((item) => item.required && !item.configured)
    .map((item) => item.name);

  const oauthConfig = getDropboxOAuthConfig();
  const rootFolder = process.env.DROPBOX_ROOT_FOLDER?.trim() || DROPBOX_DEFAULT_ROOT_FOLDER;

  return {
    appCredentialsConfigured: Boolean(oauthConfig),
    redirectUriConfigured: Boolean(getDropboxRedirectUri()),
    refreshTokenConfigured: Boolean(process.env.DROPBOX_REFRESH_TOKEN?.trim()),
    rootFolderConfigured: Boolean(process.env.DROPBOX_ROOT_FOLDER?.trim()),
    rootFolder,
    redirectUri: getDropboxRedirectUri(),
    missingEnvVars,
    envVars,
  };
}

export async function getDropboxConnectionStatus(): Promise<DropboxConnectionStatus> {
  const snapshot = getDropboxConnectionStatusSnapshot();

  if (!isDropboxConfigured()) {
    return {
      ...snapshot,
      connected: false,
      accountEmail: null,
      accountName: null,
      error: snapshot.missingEnvVars.length
        ? `Missing required environment variables: ${snapshot.missingEnvVars.join(", ")}`
        : null,
    };
  }

  try {
    const accessToken = await getDropboxAccessToken();
    const account = await getDropboxCurrentAccount(accessToken);

    return {
      ...snapshot,
      connected: true,
      accountEmail: account.email,
      accountName: account.name.display_name,
      rootFolder: getDropboxRootFolder(),
      error: null,
    };
  } catch (error) {
    return {
      ...snapshot,
      connected: false,
      accountEmail: null,
      accountName: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to verify the Dropbox connection.",
    };
  }
}

export async function testDropboxConnectionWithRefreshToken(refreshToken: string) {
  const config = getDropboxOAuthConfig();

  if (!config) {
    throw new Error("Dropbox OAuth is not configured.");
  }

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.appKey,
      client_secret: config.appSecret,
    }),
  });

  if (!response.ok) {
    throw new Error("The Dropbox refresh token could not be verified.");
  }

  const payload = (await response.json()) as { access_token: string };
  return getDropboxCurrentAccount(payload.access_token);
}
