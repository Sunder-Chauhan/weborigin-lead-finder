import { NextResponse } from "next/server";
import { discoverPublicContacts, type PublicContact } from "@/lib/public-discovery";
import { discoverSearchIndexedContacts } from "@/lib/searxng-discovery";

type JsonObject = Record<string, unknown>;
const asString = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function inferNameFromProfileSlug(linkedinUrl: string): string {
  try {
    const url = new URL(linkedinUrl);
    const slug = url.pathname.split("/").filter(Boolean)[1] ?? "";
    // LinkedIn vanity slugs sometimes end with an opaque alphanumeric identifier.
    const cleaned = slug.replace(/-[a-z0-9]{7,}$/i, (suffix) => /\d/.test(suffix) ? "" : suffix);
    const tokens = cleaned.replace(/[-_.]+/g, " ").replace(/[^a-zA-Z\s']/g, " ")
      .split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 7) return "";
    return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()).join(" ");
  } catch {
    return "";
  }
}

function isSupportedLinkedInProfile(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return (host === "linkedin.com" || host === "www.linkedin.com") &&
      /^\/(in|pub)\/[a-z0-9_%.-]+\/?$/i.test(url.pathname) &&
      (url.protocol === "https:" || url.protocol === "http:");
  } catch {
    return false;
  }
}

function pickLeadContact(contacts: PublicContact[], type: "email" | "phone"): PublicContact | undefined {
  const priority = (contact: PublicContact): number => {
    if (type === "email") {
      if (contact.verification === "published_unverified" && contact.label === "professional") return 0;
      if (contact.verification === "provider_returned_unverified") return 1;
      if (contact.verification === "inferred_unverified") return 2;
      return 3; // A role/shared inbox is less useful than a person-specific candidate.
    }
    if (contact.label === "direct") return 0;
    if (contact.verification === "provider_returned_unverified") return 1;
    if (contact.label === "company_main") return 2;
    return 3;
  };
  return contacts.filter((contact) => contact.type === type).sort((a, b) =>
    priority(a) - priority(b) || b.confidence - a.confidence
  )[0];
}

function deduplicateContacts(contacts: PublicContact[]): PublicContact[] {
  const sourceRank = (contact: PublicContact): number => {
    if (contact.label === "direct") return -1;
    if (contact.sourceName.startsWith("Official company website")) return 0;
    if (contact.verification === "provider_returned_unverified") return 1;
    if (contact.sourceName.startsWith("SearXNG")) return 2;
    if (contact.verification === "inferred_unverified") return 3;
    return 2;
  };
  const unique = new Map<string, PublicContact>();
  for (const contact of contacts) {
    const normalized = contact.type === "email"
      ? contact.value.toLowerCase()
      : contact.value.split("").filter((character) => character >= "0" && character <= "9").join("");
    const key = `${contact.type}:${normalized}`;
    const existing = unique.get(key);
    if (!existing || sourceRank(contact) < sourceRank(existing) ||
        (sourceRank(contact) === sourceRank(existing) && contact.confidence > existing.confidence)) {
      unique.set(key, contact);
    }
  }
  return [...unique.values()];
}

async function lookupTomba(linkedinUrl: string) {
  const apiKey = process.env.TOMBA_API_KEY;
  const apiSecret = process.env.TOMBA_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  const endpoint = new URL("https://api.tomba.io/v1/linkedin");
  endpoint.searchParams.set("url", linkedinUrl);
  endpoint.searchParams.set("enrich_mobile", "true");
  const response = await fetch(endpoint, {
    headers: { "X-Tomba-Key": apiKey, "X-Tomba-Secret": apiSecret, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = new Error(`Tomba returned HTTP ${response.status}.`);
    Object.assign(error, { status: response.status });
    throw error;
  }

  const body = await response.json() as { data?: JsonObject };
  const data = body.data ?? {};
  const fullName = asString(data.full_name) ||
    [asString(data.first_name), asString(data.last_name)].filter(Boolean).join(" ");
  const email = asString(data.email);
  const phoneData = Array.isArray(data.phone_data) ? data.phone_data : [];
  const phones = Array.from(new Set([
    asString(data.phone_number),
    ...phoneData.map((entry: unknown) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object") {
        const item = entry as JsonObject;
        return asString(item.phone_number) || asString(item.number) || asString(item.phone);
      }
      return "";
    }),
  ].filter(Boolean)));
  const score = typeof data.score === "number" ? Math.max(0, Math.min(1, data.score / 100)) : undefined;
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const sourceUrl = sources.map((entry: unknown) =>
    entry && typeof entry === "object" ? asString((entry as JsonObject).uri) : "").find(Boolean);
  const results: PublicContact[] = [];
  if (email) results.push({
    type: "email", value: email, label: "professional", sourceName: "Tomba enrichment API",
    sourceUrl: sourceUrl || "https://tomba.io/",
    verification: "provider_returned_unverified",
    confidence: score ?? 0.65,
    evidence: "Returned by the configured contact-enrichment provider; not independently verified by WebOrigin.",
  });
  for (const phone of phones) results.push({
    type: "phone", value: phone, label: "other", sourceName: "Tomba enrichment API (line type unverified)",
    sourceUrl: "https://tomba.io/", verification: "provider_returned_unverified",
    confidence: score ?? 0.6,
    evidence: "Returned by the configured contact-enrichment provider; WebOrigin has not independently confirmed that this is a direct mobile.",
  });
  return { fullName, company: asString(data.company), title: asString(data.position), results };
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ status: "invalid_request", message: "Send a JSON body with a linkedinUrl field." }, { status: 400 });
  }

  const body = payload && typeof payload === "object" ? payload as JsonObject : {};
  const linkedinUrl = body.linkedinUrl;
  if (!isSupportedLinkedInProfile(linkedinUrl)) {
    return NextResponse.json({
      status: "invalid_profile_url",
      message: "Enter a valid LinkedIn profile URL in the format https://www.linkedin.com/in/username/.",
      results: [],
    }, { status: 400 });
  }

  const suppliedFullName = asString(body.fullName).slice(0, 160);
  const slugName = suppliedFullName ? "" : inferNameFromProfileSlug(linkedinUrl);
  const fullName = suppliedFullName || slugName;
  const company = asString(body.company).slice(0, 200);
  const companyDomain = asString(body.companyDomain).slice(0, 500);
  const includeEmailGuess = body.includeEmailGuess === true;

  // Keep all network enrichment disabled in production until authentication,
  // per-user quotas, abuse controls, and durable usage tracking are implemented.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({
      status: "auth_required",
      message: "Public-source discovery is currently enabled for local development only. Production lookups require authentication, quotas, and abuse controls first.",
      results: [],
    }, { status: 503 });
  }

  const contacts: PublicContact[] = [];
  const pagesVisited: string[] = [];
  const notes: string[] = [];
  const searxngConfigured = Boolean(process.env.SEARXNG_BASE_URL?.trim());
  let searxngQueriesRun = 0;
  if (slugName) notes.push(`Person name was heuristically derived from the LinkedIn URL slug as "${slugName}". Confirm the identity on the source page before outreach.`);
  let resolvedFullName = fullName;
  let resolvedCompany = company;
  let resolvedTitle = "";

  if (companyDomain) {
    try {
      const publicResult = await discoverPublicContacts({ fullName, companyDomain, includeEmailGuess });
      contacts.push(...publicResult.contacts);
      pagesVisited.push(...publicResult.pagesVisited);
      notes.push(...publicResult.notes);
    } catch (error) {
      notes.push(error instanceof Error ? error.message : "The public website lookup failed.");
    }
  } else {
    notes.push(process.env.SEARXNG_BASE_URL?.trim()
      ? "No company domain was supplied, so 0 official company pages were crawled. The configured SearXNG service will search public-web snippets using the supplied or URL-derived name."
      : "No company domain was supplied, so 0 official pages were checked. SearXNG is also not configured. To search from a LinkedIn URL alone, start the included local SearXNG service and set SEARXNG_BASE_URL as described in README.md, or supply the company's official domain for direct website discovery.");
    notes.push("WebOrigin will not scrape restricted LinkedIn pages or invent hidden mobile numbers.");
  }

  // Optional broader public-web search through an operator-configured, self-hosted SearXNG instance.
  // Snippet matches are lower-confidence than addresses extracted from the official company site.
  if (searxngConfigured) {
    try {
      const searchResult = await discoverSearchIndexedContacts({
        fullName,
        companyName: company,
        companyDomain,
      });
      contacts.push(...searchResult.contacts);
      pagesVisited.push(...searchResult.pagesVisited);
      notes.push(...searchResult.notes);
      searxngQueriesRun = searchResult.queriesRun;
      if (searchResult.queriesRun) notes.push(`SearXNG public-web searches successfully queried: ${searchResult.queriesRun}.`);
    } catch (error) {
      notes.push(error instanceof Error ? `SearXNG discovery failed: ${error.message}` : "SearXNG discovery failed.");
    }
  }

  // Paid/provider data is an explicit opt-in. Merely having keys in .env.local
  // does not spend credits unless ENABLE_TOMBA_FALLBACK=true is set.
  const tombaEnabled = process.env.ENABLE_TOMBA_FALLBACK === "true";
  const hasPublishedPersonalEmail = contacts.some((c) => c.type === "email" && c.label === "professional" && c.verification === "published_unverified");
  const hasDirectPhone = contacts.some((c) => c.type === "phone" && c.label === "direct");
  if (tombaEnabled && process.env.TOMBA_API_KEY && process.env.TOMBA_API_SECRET &&
      (!hasPublishedPersonalEmail || !hasDirectPhone)) {
    try {
      const provider = await lookupTomba(linkedinUrl);
      if (provider) {
        resolvedFullName ||= provider.fullName;
        resolvedCompany ||= provider.company;
        resolvedTitle ||= provider.title;
        const freeTypes = new Set(contacts.filter((c) =>
          (c.type === "email" && c.label === "professional" && c.verification === "published_unverified") ||
          (c.type === "phone" && c.label === "direct")
        ).map((c) => c.type));
        contacts.push(...provider.results.filter((c) => !freeTypes.has(c.type)));
        notes.push("Optional Tomba fallback was enabled. Provider-returned phones are not assumed to be direct mobiles.");
      }
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status) : undefined;
      notes.push(status === 429 || status === 402 || status === 403
        ? "Tomba fallback hit a provider limit or permission restriction. No quota workaround was attempted."
        : error instanceof Error ? error.message : "Tomba fallback failed.");
    }
  }

  const finalContacts = deduplicateContacts(contacts);
  const email = pickLeadContact(finalContacts, "email");
  const phone = pickLeadContact(finalContacts, "phone");
  const hasPersonalDirectPhone = finalContacts.some((contact) => contact.type === "phone" && contact.label === "direct");
  const status = email && hasPersonalDirectPhone ? "complete" : finalContacts.length ? "partial" : "not_found";
  const searxngUnavailable = notes.some((note) => /SearXNG could not be reached|SearXNG returned HTTP|did not return JSON/i.test(note));
  const message = status === "complete"
    ? "A published email and a person-specific phone source were found. Review the source evidence before outreach."
    : status === "partial"
      ? "Some contact data was found, but WebOrigin could not confirm both a professional email and a direct personal mobile. Check each source and evidence label."
      : !companyDomain && !searxngConfigured
        ? "No contact search source ran: no company domain was supplied and SearXNG is not configured. Add the company domain or configure the included local SearXNG service."
        : searxngUnavailable
          ? "SearXNG is configured but did not return usable search results. Check that Docker/SearXNG is running and reachable at SEARXNG_BASE_URL."
          : !companyDomain && searxngConfigured && searxngQueriesRun > 0
            ? `SearXNG ran ${searxngQueriesRun} public-web searches and checked ${pagesVisited.length} accessible source pages, but found no usable contact details. Try supplying the person's official company domain as well.`
            : "No usable contact details were found. Check lookup notes for skipped pages or search configuration, or enable the optional provider fallback if appropriate.";

  return NextResponse.json({
    status,
    message,
    lead: {
      fullName: resolvedFullName,
      company: resolvedCompany,
      title: resolvedTitle,
      linkedinUrl,
      email: email?.value ?? "",
      phone: phone?.value ?? "",
      emailSource: email ? `${email.sourceName} — ${email.sourceUrl} [${email.verification}; confidence ${Math.round(email.confidence * 100)}%]${email.verification === "inferred_unverified" ? " (GUESS; unverified)" : ""}` : "",
      phoneSource: phone ? `${phone.sourceName} — ${phone.sourceUrl} [${phone.verification}; confidence ${Math.round(phone.confidence * 100)}%]` : "",
    },
    results: finalContacts,
    pagesVisited,
    notes,
    usage: { publicPagesChecked: pagesVisited.length, paidFallbackEnabled: tombaEnabled, searxngConfigured, searxngQueriesRun },
  });
}
