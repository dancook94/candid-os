import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Direct proof uploads are no longer supported. Use the chunked Upload File flow in the proof panel.",
    },
    { status: 410 }
  );
}
