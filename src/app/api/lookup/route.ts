import { NextResponse } from "next/server";

type JsonObject = Record<string, unknown>;
const asString = (value: unknown): string => typeof value === "string" ? value.trim() : "";

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

  // Until Supabase Auth and per-user product/provider quotas are enabled, this
  // provider endpoint is local-development only. Do not expose provider keys
  // through a public unauthenticated production endpoint.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({
      status: "auth_required",
      message: "Contact discovery is disabled in production until user authentication, abuse controls, and per-user quotas are enabled.",
      results: [],
    }, { status: 503 });
  }

  const apiKey = process.env.TOMBA_API_KEY;
  const apiSecret = process.env.TOMBA_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({
      status: "not_configured",
      message: "No contact provider is configured. For local testing, add TOMBA_API_KEY and TOMBA_API_SECRET to .env.local. Without provider credentials, no email or phone can be retrieved automatically.",
      results: [],
    }, { status: 501 });
  }

  try {
    const endpoint = new URL("https://api.tomba.io/v1/linkedin");
    endpoint.searchParams.set("url", linkedinUrl);
    endpoint.searchParams.set("enrich_mobile", "true");

    const providerResponse = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-Tomba-Key": apiKey,
        "X-Tomba-Secret": apiSecret,
        "Accept": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });

    if (providerResponse.status === 429) {
      return NextResponse.json({
        status: "provider_limit",
        message: "Tomba rate or usage limit reached. No alternate accounts or quota bypasses were attempted. Check your provider dashboard before retrying.",
        results: [],
      }, { status: 429 });
    }

    if (providerResponse.status === 402 || providerResponse.status === 403) {
      return NextResponse.json({
        status: "provider_quota_or_permission",
        message: "The provider rejected this lookup due to quota, permission, or plan limits. Check your Tomba plan and usage.",
        results: [],
      }, { status: 402 });
    }

    if (!providerResponse.ok) {
      return NextResponse.json({
        status: "provider_error",
        message: `Contact provider returned HTTP ${providerResponse.status}. Check the API credentials and provider dashboard.`,
        results: [],
      }, { status: 502 });
    }

    const response = await providerResponse.json() as { data?: JsonObject };
    const data = response.data ?? {};
    const name = asString(data.full_name) ||
      [asString(data.first_name), asString(data.last_name)].filter(Boolean).join(" ");
    const email = asString(data.email);
    const phoneNumber = asString(data.phone_number);
    const phoneData = Array.isArray(data.phone_data) ? data.phone_data : [];
    const phonesFromData = phoneData.map((entry: unknown) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object") {
        const item = entry as JsonObject;
        return asString(item.phone_number) || asString(item.number) || asString(item.phone);
      }
      return "";
    }).filter(Boolean);
    const phones = Array.from(new Set([phoneNumber, ...phonesFromData].filter(Boolean)));
    const verification = data.verification && typeof data.verification === "object"
      ? asString((data.verification as JsonObject).status).toLowerCase()
      : "unknown";
    const score = typeof data.score === "number" ? Math.max(0, Math.min(1, data.score / 100)) : undefined;
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const sourceUrl = sources.map((entry: unknown) => entry && typeof entry === "object" ? asString((entry as JsonObject).uri) : "").find(Boolean);

    const results: Array<{ type: "email" | "phone"; value: string; sourceName: string; sourceUrl?: string; verification: string; confidence?: number }> = [];
    if (email) results.push({
      type: "email",
      value: email,
      sourceName: "Tomba enrichment API",
      ...(sourceUrl ? { sourceUrl } : {}),
      verification: verification === "valid" ? "provider_verified" : verification === "invalid" ? "invalid" : "unverified",
      ...(score !== undefined ? { confidence: score } : {}),
    });
    for (const phone of phones) results.push({
      type: "phone",
      value: phone,
      sourceName: "Tomba enrichment API",
      verification: "unverified",
      ...(score !== undefined ? { confidence: score } : {}),
    });

    const status = results.length === 0 ? "not_found" : (results.some(r => r.type === "email") && results.some(r => r.type === "phone") ? "complete" : "partial");
    return NextResponse.json({
      status,
      message: status === "complete"
        ? "Email and phone results returned by Tomba. Review source and verification status before outreach."
        : status === "partial"
          ? "Only partial contact data was found. A missing email or phone is not inferred."
          : "No contact was found by the configured provider for this profile.",
      lead: {
        fullName: name,
        company: asString(data.company),
        title: asString(data.position),
        linkedinUrl,
        email,
        phone: phones[0] ?? "",
        emailSource: email ? "Tomba enrichment API" : "",
        phoneSource: phones.length ? "Tomba enrichment API (not independently verified)" : "",
      },
      results,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({
      status: timedOut ? "provider_timeout" : "provider_unavailable",
      message: timedOut
        ? "The provider lookup timed out. Try later; no alternate account was used."
        : "Could not contact the provider. Check network connectivity and try again.",
      results: [],
    }, { status: timedOut ? 504 : 502 });
  }
}
