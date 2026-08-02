import {
  dropboxContentUpload,
  type DropboxFileMetadata,
} from "@/lib/dropbox/client";

export async function startDropboxUploadSession() {
  return dropboxContentUpload<{ session_id: string }>(
    "/2/files/upload_session/start",
    {
      arg: {
        close: false,
      },
      body: new Uint8Array(0),
    }
  );
}

export async function appendDropboxUploadSession(
  sessionId: string,
  offset: number,
  chunk: ArrayBuffer
) {
  await dropboxContentUpload<Record<string, never>>(
    "/2/files/upload_session/append_v2",
    {
      arg: {
        cursor: {
          session_id: sessionId,
          offset,
        },
        close: false,
      },
      body: chunk,
    }
  );
}

export async function finishDropboxUploadSession({
  sessionId,
  totalSize,
  dropboxPath,
}: {
  sessionId: string;
  totalSize: number;
  dropboxPath: string;
}) {
  return dropboxContentUpload<{ metadata: DropboxFileMetadata }>(
    "/2/files/upload_session/finish",
    {
      arg: {
        cursor: {
          session_id: sessionId,
          offset: totalSize,
        },
        commit: {
          path: dropboxPath,
          mode: "add",
          autorename: true,
          mute: false,
          strict_conflict: false,
        },
      },
      body: new Uint8Array(0),
    }
  );
}

export async function uploadSmallDropboxFile({
  dropboxPath,
  body,
}: {
  dropboxPath: string;
  body: ArrayBuffer;
}) {
  return dropboxContentUpload<{ metadata: DropboxFileMetadata }>(
    "/2/files/upload",
    {
      arg: {
        path: dropboxPath,
        mode: "add",
        autorename: true,
        mute: false,
        strict_conflict: false,
      },
      body,
    }
  );
}
