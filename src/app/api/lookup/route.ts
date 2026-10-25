import { NextResponse } from "next/server";

function isSupportedLinkedInProfile(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return (
      (host === "linkedin.com" || host === "www.linkedin.com") &&
      /^\/(in|pub)\/[a-z0-9_%.-]+\/?$/i.test(url.pathname) &&
      (url.protocol === "https:" || url.protocol === "http:")
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ status: "invalid_request", message: "Send a JSON body with a linkedinUrl field." }, { status: 400 });
  }

  const linkedinUrl =
    typeof payload === "object" && payload !== null && "linkedinUrl" in payload
      ? payload.linkedinUrl
      : undefined;

  if (!isSupportedLinkedInProfile(linkedinUrl)) {
    return NextResponse.json({
      status: "invalid_profile_url",
      message: "Enter a valid LinkedIn profile URL in the format https://www.linkedin.com/in/username/.",
      results: [],
    }, { status: 400 });
  }

  // Enrichment is intentionally disabled until an authorized provider adapter,
  // authentication, per-user quotas, and source attribution are configured.
  // Do not enable an external provider here without those production controls.
  return NextResponse.json({
    status: "not_configured",
    message: "The profile URL is valid, but contact discovery is not configured yet. No email or phone was retrieved.",
    results: [],
  }, { status: 501 });
}
