import type { PublicContact } from "@/lib/public-discovery";

type SearchResult = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  engine?: unknown;
};

type SearxResponse = { results?: SearchResult[] };

const asString = (value: unknown) => typeof value === "string" ? value.trim() : "";

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase().replace(/[.,;:)]+$/, "");
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null;
  if (email.includes("..")) return null;
  return email;
}

function normalizePhone(raw: string): string | null {
  const value = raw.trim().replace(/[;,.)]+$/, "");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (!value.startsWith("+") && !/[()\s.-]/.test(value)) return null;
  return value;
}

function resultUrl(value: unknown): string | null {
  const raw = asString(value);
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isCompanyEmail(email: string, companyDomain?: string): boolean {
  if (!companyDomain) return true;
  const domain = companyDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/:?#]/)[0].replace(/^www\./, "");
  return email.endsWith(`@${domain}`);
}

/**
 * Optional, admin-configured SearXNG integration. This calls a search instance
 * owned/configured by the operator; it does not scrape LinkedIn and does not
 * bypass the search engines' controls. Results are treated as snippets, not proof.
 */
export async function discoverSearchIndexedContacts(input: {
  fullName?: string;
  companyName?: string;
  companyDomain?: string;
}): Promise<{ contacts: PublicContact[]; notes: string[]; queriesRun: number }> {
  const configured = process.env.SEARXNG_BASE_URL?.trim();
  if (!configured) return { contacts: [], notes: [], queriesRun: 0 };

  let base: URL;
  try {
    base = new URL(configured.endsWith("/") ? configured : configured + "/");
  } catch {
    return { contacts: [], notes: ["SEARXNG_BASE_URL is configured but is not a valid URL."], queriesRun: 0 };
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    return { contacts: [], notes: ["SEARXNG_BASE_URL must be an HTTP/HTTPS URL without embedded credentials."], queriesRun: 0 };
  }

  const fullName = (input.fullName ?? "").trim();
  const companyName = (input.companyName ?? "").trim();
  const companyDomain = (input.companyDomain ?? "").trim();
  if (!fullName && !companyDomain && !companyName) {
    return { contacts: [], notes: ["SearXNG discovery needs a person name, company name, or company domain."], queriesRun: 0 };
  }

  const context = [fullName ? `"${fullName}"` : "", companyName ? `"${companyName}"` : "", companyDomain ? `site:${companyDomain.replace(/^https?:\/\//, "").split(/[/:?#]/)[0]}` : ""]
    .filter(Boolean).join(" ");
  const queries = fullName
    ? [`${context} email`, `${context} phone contact`]
    : [`${context} email contact phone`];
  const contacts: PublicContact[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const endpoint = new URL("search", base);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("language", "all");
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Accept: "application/json", "User-Agent": "WebOriginLeadFinder/1.0 (+public-source discovery)" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      notes.push("SearXNG could not be reached. The local company-site crawler still ran where a domain was supplied.");
      break;
    }
    if (!response.ok) {
      notes.push(`SearXNG returned HTTP ${response.status}; search-snippet discovery was skipped.`);
      break;
    }
    let body: SearxResponse;
    try {
      body = await response.json() as SearxResponse;
    } catch {
      notes.push("SearXNG did not return JSON. Ensure JSON format is enabled on the configured instance.");
      break;
    }
    const results = Array.isArray(body.results) ? body.results.slice(0, 8) : [];
    for (const result of results) {
      const sourceUrl = resultUrl(result.url);
      if (!sourceUrl) continue;
      const title = asString(result.title);
      const snippet = asString(result.content).slice(0, 1600);
      const evidenceText = `${title} ${snippet}`;
      const emails = evidenceText.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
      for (const rawEmail of emails) {
        const email = normalizeEmail(rawEmail);
        if (!email || !isCompanyEmail(email, companyDomain)) continue;
        const key = `email:${email}`;
        if (seen.has(key)) continue;
        seen.add(key);
        contacts.push({
          type: "email",
          value: email,
          label: "professional",
          sourceName: "SearXNG-indexed public page (snippet; not independently fetched)",
          sourceUrl,
          verification: "published_unverified",
          confidence: 0.48,
          evidence: `Search snippet: ${evidenceText.slice(0, 240)}`,
        });
      }

      const phoneMatches = evidenceText.match(/(?:\+\s*\d{1,3}[\s().-]*)?(?:\(?\d{2,5}\)?[\s.-]+)?\d[\d\s().-]{5,}\d/g) ?? [];
      for (const rawPhone of phoneMatches) {
        const phone = normalizePhone(rawPhone);
        if (!phone) continue;
        const key = `phone:${phone.replace(/\D/g, "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        contacts.push({
          type: "phone",
          value: phone,
          label: "other",
          sourceName: "SearXNG-indexed public page (phone line type unverified)",
          sourceUrl,
          verification: "published_unverified",
          confidence: 0.42,
          evidence: `Search snippet: ${evidenceText.slice(0, 240)}`,
        });
      }
    }
  }

  if (contacts.length) notes.push("Search-engine snippets are leads, not independent verification. Open the source page before relying on a contact.");
  return { contacts, notes, queriesRun: queries.length };
}
