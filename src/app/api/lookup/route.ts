import { NextResponse } from "next/server";

export async function POST() {
  // Deliberately no provider calls yet. This endpoint is the server-side seam
  // where an authorized public-source or enrichment provider can be configured.
  return NextResponse.json({
    status: "not_configured",
    message: "Contact discovery is not configured yet. Add an authorized server-side source adapter before returning contact data.",
    results: [],
  }, { status: 501 });
}
