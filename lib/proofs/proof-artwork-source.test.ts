import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findJobFileIdForDropboxPath,
  mergeCustomerArtworkDiscoveryFiles,
} from "@/lib/proofs/customer-artwork-discovery";
import {
  mapAttachFailureMessage,
  readAttachResponsePayload,
} from "@/lib/proofs/proof-attachment-utils";
import { isPathUnderSubfolder } from "@/lib/proofs/file-validation";
import { CUSTOMER_UPLOAD_SUBFOLDER, WORKING_FILES_SUBFOLDER } from "@/lib/dropbox/job-folders";
import {
  buildStaffProofWorkingFilePath,
  validateStaffProofSourceUploadInput,
} from "@/lib/proofs/staff-artwork-upload";
import {
  isProofSourceAttachExtension,
  proofSourceAttachExtensionError,
} from "@/lib/proofs/source-artwork-formats";

describe("proof attachment response parsing", () => {
  it("handles non-JSON 413 responses without throwing", async () => {
    const response = new Response("<html>Request Entity Too Large</html>", {
      status: 413,
      headers: { "content-type": "text/html" },
    });

    const payload = await readAttachResponsePayload(response);
    assert.match(payload.error ?? "", /too large/i);
    assert.equal(
      mapAttachFailureMessage(payload, response, "fallback"),
      payload.error
    );
  });

  it("handles fetch-style JSON error payloads", async () => {
    const response = new Response(JSON.stringify({ error: "Upload chunk failed." }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });

    const payload = await readAttachResponsePayload(response);
    assert.equal(payload.error, "Upload chunk failed.");
  });
});

describe("customer artwork discovery", () => {
  const jobFolder = "/Candid OS Jobs/J-10 - Example Job";

  it("merges Dropbox files with matching portal job_files records", () => {
    const merged = mergeCustomerArtworkDiscoveryFiles(
      [
        {
          id: "dbx-1",
          name: "Artwork.pdf",
          path: `${jobFolder}/01 Customer Artwork/Artwork.pdf`,
          size: 1234,
        },
      ],
      [
        {
          id: "job-file-1",
          file_name: "Artwork.pdf",
          upload_status: "complete",
          dropbox_path_lower: `${jobFolder}/01 Customer Artwork/Artwork.pdf`,
        },
      ]
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.jobFileId, "job-file-1");
    assert.equal(merged[0]?.portalUploaded, true);
  });

  it("includes manually copied Dropbox files without job_files rows", () => {
    const merged = mergeCustomerArtworkDiscoveryFiles(
      [
        {
          id: "dbx-2",
          name: "ManualCopy.pdf",
          path: `${jobFolder}/01 Customer Artwork/ManualCopy.pdf`,
          size: 4567,
        },
      ],
      []
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.jobFileId, null);
    assert.equal(merged[0]?.portalUploaded, false);
  });

  it("rejects customer artwork paths outside the job folder", () => {
    const allowed = isPathUnderSubfolder(
      `${jobFolder}/01 Customer Artwork/Allowed.pdf`,
      jobFolder,
      CUSTOMER_UPLOAD_SUBFOLDER
    );
    const blocked = isPathUnderSubfolder(
      "/Candid OS Jobs/J-99 - Other Job/01 Customer Artwork/Blocked.pdf",
      jobFolder,
      CUSTOMER_UPLOAD_SUBFOLDER
    );

    assert.equal(allowed, true);
    assert.equal(blocked, false);
  });

  it("finds job_file_id for a Dropbox path when available", () => {
    const jobFileId = findJobFileIdForDropboxPath(
      `${jobFolder}/01 Customer Artwork/Portal.pdf`,
      [
        {
          id: "jf-1",
          file_name: "Portal.pdf",
          upload_status: "complete",
          dropbox_path_lower: `${jobFolder}/01 Customer Artwork/Portal.pdf`,
        },
      ]
    );

    assert.equal(jobFileId, "jf-1");
  });
});

describe("working files path validation", () => {
  it("accepts paths under 02 Working Files for the linked job", () => {
    const jobFolder = "/Candid OS Jobs/J-10 - Example Job";
    assert.equal(
      isPathUnderSubfolder(
        `${jobFolder}/02 Working Files/Design.ai`,
        jobFolder,
        WORKING_FILES_SUBFOLDER
      ),
      true
    );
  });
});

describe("staff proof source upload validation", () => {
  it("accepts PDF uploads within the artwork upload limit", () => {
    assert.equal(
      validateStaffProofSourceUploadInput({
        fileName: "LargeArt.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 40 * 1024 * 1024,
      }),
      null
    );
  });

  it("accepts PDF-compatible AI uploads", () => {
    assert.equal(isProofSourceAttachExtension("Design.ai"), true);
    assert.equal(
      validateStaffProofSourceUploadInput({
        fileName: "Design.ai",
        mimeType: "application/postscript",
        fileSizeBytes: 1024,
      }),
      null
    );
  });

  it("rejects EPS uploads for staff proof source upload", () => {
    assert.equal(isProofSourceAttachExtension("Design.eps"), false);
    assert.match(
      validateStaffProofSourceUploadInput({
        fileName: "Design.eps",
        mimeType: "application/postscript",
        fileSizeBytes: 1024,
      }) ?? "",
      /cannot be attached/i
    );
  });

  it("rejects oversize uploads with a clear error", () => {
    const maxBytes = 500 * 1024 * 1024;
    assert.match(
      validateStaffProofSourceUploadInput({
        fileName: "Huge.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: maxBytes + 1,
      }) ?? "",
      /maximum upload size/i
    );
  });

  it("builds working-file upload paths inside 02 Working Files", () => {
    const path = buildStaffProofWorkingFilePath(
      "/Candid OS Jobs/J-10 - Example Job",
      "My Design.pdf"
    );

    assert.match(path, /\/02 Working Files\/My-Design\.pdf$/);
  });
});

describe("proof-generation compatibility messaging", () => {
  it("blocks EPS from entering proof source attach flow", () => {
    assert.match(proofSourceAttachExtensionError("Design.eps") ?? "", /cannot be attached/i);
  });
});
