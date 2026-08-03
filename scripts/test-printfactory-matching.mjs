#!/usr/bin/env node

/**
 * Dev helper: audit PrintFactory list response and job-reference extraction.
 * Usage: node scripts/test-printfactory-matching.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eq = trimmed.indexOf("=");

      if (eq === -1) {
        continue;
      }

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

const baseUrl =
  process.env.PRINTFACTORY_API_BASE_URL?.trim() || "https://api.aurelon.com";
const token =
  process.env.PRINTFACTORY_API_TOKEN?.trim() ||
  process.env.PRINTFACTORY_API_KEY?.trim();

if (!token) {
  console.error("Missing PRINTFACTORY_API_TOKEN");
  process.exit(1);
}

const CANDID_JOB_REFERENCE_PATTERN = /\b(J-\d+)\b/gi;
const J_COMPACT_PATTERN = /\bJ\s?-?\s?(\d{1,6})\b/gi;

function extractRefs(text) {
  if (!text?.trim()) {
    return [];
  }

  const found = new Set();

  for (const match of text.matchAll(CANDID_JOB_REFERENCE_PATTERN)) {
    found.add(match[1].toUpperCase());
  }

  for (const match of text.matchAll(J_COMPACT_PATTERN)) {
    found.add(`J-${match[1]}`);
  }

  return [...found];
}

function firstDocument(raw) {
  const documents = Array.isArray(raw.Documents) ? raw.Documents : [];
  return documents.find((entry) => entry && typeof entry === "object");
}

function pickPath(raw, document) {
  const keys = [
    "SourceFilePath",
    "FilePath",
    "Path",
    "InputPath",
    "DocumentPath",
    "Folder",
  ];

  for (const key of keys) {
    if (typeof raw[key] === "string" && raw[key].trim()) {
      return raw[key].trim();
    }

    if (document && typeof document[key] === "string" && document[key].trim()) {
      return document[key].trim();
    }
  }

  return null;
}

const response = await fetch(`${baseUrl}/api/v2/job/list`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    MisKey: token,
  },
  body: JSON.stringify({ Skip: 0, Take: 100 }),
});

const payload = await response.json();
const records = Array.isArray(payload) ? payload : [];

let withPath = 0;
let withExactRef = 0;
const samples = [];

for (const record of records) {
  const document = firstDocument(record);
  const path = pickPath(record, document);
  const jobName = record.JobName ?? null;
  const documentName = document?.Name ?? null;
  const sourceFileName = documentName;

  if (path) {
    withPath += 1;
  }

  const searchTexts = [path, sourceFileName, jobName, documentName].filter(Boolean);
  const refs = new Set();

  for (const text of searchTexts) {
    for (const ref of extractRefs(text)) {
      refs.add(ref);
    }
  }

  if (refs.size === 1) {
    withExactRef += 1;
  }

  if (samples.length < 5) {
    samples.push({
      keys: Object.keys(record),
      documentKeys: document ? Object.keys(document) : [],
      jobName,
      documentName,
      path,
      refs: [...refs],
    });
  }
}

console.log(
  JSON.stringify(
    {
      status: response.status,
      totalRecords: records.length,
      withSourcePath: withPath,
      withSingleExactJobReference: withExactRef,
      wouldAutoMatchByReference: withExactRef,
      pathFieldNote:
        withPath === 0
          ? "/api/v2/job/list does not return source paths; filenames come from Documents[].Name"
          : "Source paths present on some records",
      sampleAudit: samples,
    },
    null,
    2
  )
);
