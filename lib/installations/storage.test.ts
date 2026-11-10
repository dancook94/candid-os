import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstallationDocumentPath,
  buildInstallationPhotoPath,
  isValidInstallationStoragePath,
  storageInstallationVisitIdFromPath,
  validateInstallationDocumentUpload,
  validateInstallationPhotoUpload,
} from "@/lib/installations/storage";

const visitId = "8d4f4b4a-1111-4222-8333-444444444444";

test("storage paths are scoped under visit id", () => {
  const doc = buildInstallationDocumentPath(visitId, "rams", "site-rams.pdf");
  const photo = buildInstallationPhotoPath(visitId, "before", "photo.jpg");

  assert.match(doc, new RegExp(`^${visitId}/documents/rams/`));
  assert.match(photo, new RegExp(`^${visitId}/photos/before/`));
  assert.equal(storageInstallationVisitIdFromPath(doc), visitId);
  assert.equal(isValidInstallationStoragePath(doc, visitId), true);
});

test("photo and document validators enforce size and mime", () => {
  assert.equal(
    validateInstallationPhotoUpload({ mimeType: "image/jpeg", byteSize: 1024 }),
    null
  );
  assert.equal(
    validateInstallationPhotoUpload({ mimeType: "application/pdf", byteSize: 1024 }),
    "Unsupported photo type."
  );
  assert.equal(
    validateInstallationDocumentUpload({
      mimeType: "application/pdf",
      byteSize: 26 * 1024 * 1024,
    }),
    "Document exceeds the size limit."
  );
});
