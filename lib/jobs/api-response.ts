import { NextResponse } from "next/server";

import { JobError } from "@/lib/jobs/errors";

export function jobErrorResponse(error: unknown) {
  if (error instanceof JobError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: "Request failed." }, { status: 500 });
}
