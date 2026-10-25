import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type PublicContact = {
  type: "email" | "phone";
  value: string;
  label: "professional" | "direct" | "company_main" | "other";
  sourceName: string;
  sourceUrl: string;
  verification: "published_unverified" | "inferred_unverified" | "provider_returned_unverified";
  confidence: number;
  evidence: string;
};

export type PublicDiscoveryInput = {
  fullName?: string;
  companyDomain?: string;
  includeEmailGuess?: boolean;
};

export type PublicDiscoveryResult = {
  contacts: PublicContact[];
  pagesVisited: string[];
  notes: string[];
  domain: string;
};

type PublicPageResponse = { url: URL; status: number; text: string; contentType: string };

const MAX_PAGE_BYTES = 900_000;
const MAX_PAGES = 6;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: PublicDiscoveryResult }>();
const lastRequestAt = new Map<string, number>();
const pageCache = new Map<string, { expiresAt: number; resolvedUrl: string; status: number; text: string; contentType: string }>();

const asText = (value: string) => value.replace(/\s+/g, " ").trim();

function ipv4IsNonPublic(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function ipv6IsNonPublic(address: string): boolean {
  const ip = address.toLowerCase().split("%")[0];
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice(7);
    if (mapped.includes(".")) return ipv4IsNonPublic(mapped);
    return true;
  }
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
    /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("2001:db8:");
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test")) {
    throw new Error("Private or local website addresses are not allowed.");
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4 && ipv4IsNonPublic(host)) throw new Error("Private or non-public IP addresses are not allowed.");
  if (ipVersion === 6 && ipv6IsNonPublic(host)) throw new Error("Private or non-public IP addresses are not allowed.");
  if (ipVersion) return;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("The company domain could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address, family }) =>
    family === 4 ? ipv4IsNonPublic(address) : ipv6IsNonPublic(address))) {
    throw new Error("The company domain resolves to a private or non-public address and was blocked.");
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number: string) => String.fromCharCode(Number(number)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlToText(html: string): string {
  return asText(decodeEntities(html
    .replace(/<(script|style|noscript|svg|template|head)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")));
}

function safeEmail(value: string): string | null {
  const email = decodeEntities(value).trim().replace(/^mailto:/i, "").split("?")[0].toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null;
  if (email.startsWith(".") || email.includes("..")) return null;
  return email;
}

function safePhone(value: string): string | null {
  const candidate = decodeEntities(value).replace(/^tel:/i, "").split(/[;,?]/)[0].trim();
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  // Require some phone-like formatting to avoid treating dates, IDs, and ZIPs as telephone numbers.
  if (!candidate.startsWith("+") && !/[()\s.-]/.test(candidate)) return null;
  return asText(candidate);
}

function robotsRuleMatches(rule: string, pathname: string): boolean {
  const exact = rule.endsWith("$");
  const normalized = exact ? rule.slice(0, -1) : rule;
  const special = new Set([".", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", String.fromCharCode(92)]);
  const expression = normalized.split("*")
    .map((part) => [...part].map((character) =>
      special.has(character) ? String.fromCharCode(92) + character : character
    ).join(""))
    .join(".*");
  try {
    return new RegExp("^" + expression + (exact ? "$" : "")).test(pathname);
  } catch {
    return true;
  }
}
function isAllowedByRobots(robots: string, pathname: string): boolean {
  const groups: Array<{ agents: string[]; disallows: string[] }> = [];
  let group: { agents: string[]; disallows: string[] } = { agents: [], disallows: [] };
  let hasDirective = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === "user-agent") {
      if (hasDirective || (group.agents.length && group.disallows.length)) {
        groups.push(group);
        group = { agents: [], disallows: [] };
        hasDirective = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (key === "disallow" && value) {
      group.disallows.push(value);
      hasDirective = true;
    } else if (key === "allow") {
      hasDirective = true;
    }
  }
  if (group.agents.length) groups.push(group);
  const exact = groups.filter((entry) => entry.agents.some((agent) => agent === "weboriginleadfinder"));
  const applicable = exact.length ? exact : groups.filter((entry) => entry.agents.includes("*"));
  const disallows = applicable.flatMap((entry) => entry.disallows);
  return !disallows.some((rule) => robotsRuleMatches(rule, pathname));
}
async function waitForHost(hostname: string): Promise<void> {
  const now = Date.now();
  const previous = lastRequestAt.get(hostname) ?? 0;
  const waitMs = Math.max(0, 350 - (now - previous));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt.set(hostname, Date.now());
}

async function safeFetchText(startUrl: URL): Promise<PublicPageResponse> {
  const cacheKey = startUrl.href;
  const cached = pageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { url: new URL(cached.resolvedUrl), status: cached.status, text: cached.text, contentType: cached.contentType };
  }
  if (cached) pageCache.delete(cacheKey);
  const cacheAndReturn = (result: PublicPageResponse): PublicPageResponse => {
    if (result.status === 200 || result.status === 404 || result.status === 410) {
      pageCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        resolvedUrl: result.url.href,
        status: result.status,
        text: result.text,
        contentType: result.contentType,
      });
      if (pageCache.size > 2_000) {
        const oldestKey = pageCache.keys().next().value;
        if (oldestKey) pageCache.delete(oldestKey);
      }
    }
    return result;
  };
  let current = new URL(startUrl.href);
  for (let hop = 0; hop <= 3; hop++) {
    if (!["http:", "https:"].includes(current.protocol) || current.username || current.password) {
      throw new Error("Only public HTTP/HTTPS pages are supported.");
    }
    await assertPublicHost(current.hostname);
    await waitForHost(current.hostname);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent": "WebOriginLeadFinder/1.0 (+public-source contact discovery; honors robots.txt)",
        "Accept": "text/html,text/plain,application/xhtml+xml, text/*;q=0.8",
      },
      signal: AbortSignal.timeout(7_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 3) throw new Error("Too many or invalid redirects from the company website.");
      const next = new URL(location, current);
      // Keep redirects on the same hostname. Cross-host redirects are not followed.
      if (next.hostname.toLowerCase() !== current.hostname.toLowerCase()) {
        throw new Error("A cross-domain redirect was blocked by the public-source fetcher.");
      }
      current = next;
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_PAGE_BYTES) throw new Error("The webpage is larger than the allowed page-size limit.");
    if (!response.ok) return cacheAndReturn({ url: current, status: response.status, text: "", contentType });
    if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      return cacheAndReturn({ url: current, status: response.status, text: "", contentType });
    }
    if (!response.body) return { url: current, status: response.status, text: "", contentType };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PAGE_BYTES) {
          await reader.cancel();
          throw new Error("The webpage is larger than the allowed page-size limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return cacheAndReturn({ url: current, status: response.status, text: new TextDecoder().decode(bytes), contentType });
  }
  throw new Error("Could not safely resolve the company website URL.");
}

function candidatePages(home: URL, html: string): URL[] {
  const candidates: URL[] = [new URL("/", home)];
  const seen = new Set<string>([candidates[0].href]);
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)];
  const selected = links.map((match) => {
    const href = decodeEntities(match[1]).trim();
    const label = htmlToText(match[2]).toLowerCase();
    return { href, label };
  }).filter(({ href, label }) =>
    /contact|about|team|leadership|people|management|our-company|who-we-are/.test(label + " " + href));
  for (const { href } of selected) {
    try {
      const url = new URL(href, home);
      if (url.hostname.toLowerCase() !== home.hostname.toLowerCase() ||
          !["http:", "https:"].includes(url.protocol)) continue;
      url.hash = "";
      if (url.search) continue;
      if (!seen.has(url.href)) { seen.add(url.href); candidates.push(url); }
    } catch { /* Ignore malformed webpage links. */ }
  }
  // Try conventional paths only after actual navigation links.
  for (const path of ["/contact", "/about", "/team", "/leadership", "/people", "/our-team", "/about-us"]) {
    const url = new URL(path, home);
    if (!seen.has(url.href)) { seen.add(url.href); candidates.push(url); }
  }
  return candidates.slice(0, MAX_PAGES);
}

function inferEmail(fullName: string, domain: string): string | null {
  const parts = fullName.toLowerCase().normalize("NFKD").replace(/[^a-z\s'-]/g, "")
    .replace(/['-]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last || first.length < 2 || last.length < 2) return null;
  return safeEmail(`${first}.${last}@${domain}`);
}

function compactEvidence(text: string, value: string): string {
  const index = text.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return text.slice(0, 180);
  return text.slice(Math.max(0, index - 65), Math.min(text.length, index + value.length + 100)).trim();
}

export async function discoverPublicContacts(input: PublicDiscoveryInput): Promise<PublicDiscoveryResult> {
  if (!input.companyDomain?.trim()) {
    return {
      contacts: [],
      pagesVisited: [],
      notes: ["Enter the company's official website/domain to search free public sources. A LinkedIn URL alone does not reveal hidden contact details."],
      domain: "",
    };
  }

  let home: URL;
  const rawDomain = input.companyDomain.trim();
  try {
    home = new URL(/^https?:\/\//i.test(rawDomain) ? rawDomain : `https://${rawDomain}`);
  } catch {
    throw new Error("Enter a valid company website, such as example.com.");
  }
  if (!["http:", "https:"].includes(home.protocol) || home.username || home.password ||
      !home.hostname.includes(".") || home.hostname.length > 253) {
    throw new Error("Enter a valid public company website/domain, such as example.com.");
  }
  home.hash = "";
  home.search = "";
  const domain = home.hostname.toLowerCase();
  const emailDomain = domain.startsWith("www.") ? domain.slice(4) : domain;
  const cacheKey = `${domain}|${(input.fullName ?? "").trim().toLowerCase()}|${Boolean(input.includeEmailGuess)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  await assertPublicHost(home.hostname);
  let robots: string;
  try {
    const robotResponse = await safeFetchText(new URL("/robots.txt", home));
    if (robotResponse.status === 404 || robotResponse.status === 410) robots = "";
    else if (robotResponse.status !== 200) {
      throw new Error("robots.txt could not be checked safely; crawling was stopped.");
    } else robots = robotResponse.text;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Could not check robots.txt.");
  }

  if (!isAllowedByRobots(robots, home.pathname || "/")) {
    return {
      contacts: [],
      pagesVisited: [],
      notes: ["The homepage path is disallowed by robots.txt; the crawler stopped without fetching it."],
      domain,
    };
  }

  const homeResponse = await safeFetchText(home);
  if (homeResponse.status !== 200 || !homeResponse.text) {
    throw new Error(`The company homepage returned HTTP ${homeResponse.status} or did not serve readable HTML.`);
  }
  const urls = candidatePages(homeResponse.url, homeResponse.text);
  const contacts: PublicContact[] = [];
  const pagesVisited: string[] = [];
  const emailSeen = new Set<string>();
  const phoneSeen = new Set<string>();
  const notes: string[] = [];
  const fullName = (input.fullName ?? "").trim();
  const nameLower = fullName.toLowerCase();

  for (const pageUrl of urls) {
    if (!isAllowedByRobots(robots, pageUrl.pathname)) continue;
    let page: { url: URL; status: number; text: string; contentType: string };
    try {
      page = pageUrl.href === homeResponse.url.href ? homeResponse : await safeFetchText(pageUrl);
    } catch (error) {
      notes.push(`Skipped ${pageUrl.pathname}: ${error instanceof Error ? error.message : "fetch failed"}`);
      continue;
    }
    if (page.status !== 200 || !page.text) continue;
    pagesVisited.push(page.url.href);
    const visible = htmlToText(page.text);
    const visibleLower = visible.toLowerCase();
    const pageMatchesName = nameLower.length > 0 && visibleLower.includes(nameLower);

    const allEmails = [
      ...[...page.text.matchAll(/href\s*=\s*["']mailto:([^"'?#]+)[^"']*["']/gi)].map((m) => decodeEntities(m[1])),
      ...visible.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [],
    ];
    for (const raw of allEmails) {
      const email = safeEmail(raw);
      if (!email || emailSeen.has(email)) continue;
      // Preserve the official site/domain boundary; third-party email addresses on a page can be unrelated.
      if (!email.endsWith(`@${emailDomain}`) && !email.endsWith(`@${domain}`)) continue;
      emailSeen.add(email);
      const local = email.split("@")[0];
      const nameMatchesEmail = fullName && local.replace(/[._+-]/g, " ").includes(nameLower.replace(/\s+/g, " "));
      const roleInbox = /^(info|sales|support|hello|contact|admin|office|careers|jobs|press|marketing|enquir|enquiry|enquiries|customerservice)([._+-].*)?$/i.test(local);
      contacts.push({
        type: "email",
        value: email,
        label: roleInbox ? "other" : "professional",
        sourceName: roleInbox ? "Official company website (shared/role inbox)" : "Official company website (published email)",
        sourceUrl: page.url.href,
        verification: "published_unverified",
        confidence: nameMatchesEmail ? 0.96 : roleInbox ? 0.78 : 0.86,
        evidence: compactEvidence(visible, email),
      });
    }

    const phoneCandidates = [
      ...[...page.text.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)].map((m) => decodeEntities(m[1])),
      ...(visible.match(/(?:\+\s*\d{1,3}[\s().-]*)?(?:\(?\d{2,5}\)?[\s.-]+)?\d[\d\s().-]{5,}\d/g) ?? []),
    ];
    for (const raw of phoneCandidates) {
      const phone = safePhone(raw);
      if (!phone || phoneSeen.has(phone.replace(/\D/g, ""))) continue;
      phoneSeen.add(phone.replace(/\D/g, ""));
      const phoneIndex = visible.indexOf(phone);
      const nearName = pageMatchesName && nameLower.length > 0 && phoneIndex >= 0 &&
        Math.abs(visibleLower.indexOf(nameLower) - phoneIndex) < 180;
      contacts.push({
        type: "phone",
        value: phone,
        // A number published on a company site is not assumed to be a direct mobile.
        label: "company_main",
        sourceName: nearName
          ? "Official website (number near person's name; line type unverified)"
          : "Official company website (public phone; not confirmed as a direct mobile)",
        sourceUrl: page.url.href,
        verification: "published_unverified",
        confidence: nearName ? 0.72 : 0.82,
        evidence: compactEvidence(visible, phone),
      });
    }
  }

  if (!contacts.some((c) => c.type === "email" && c.label === "professional") && input.includeEmailGuess && fullName) {
    const guess = inferEmail(fullName, emailDomain);
    if (guess) {
      contacts.push({
        type: "email",
        value: guess,
        label: "professional",
        sourceName: "Generated candidate (guess; not found on the website)",
        sourceUrl: home.href,
        verification: "inferred_unverified",
        confidence: 0.25,
        evidence: "Generated from the person's name and domain using a common first.last@domain pattern. This was not published or verified.",
      });
      notes.push("An email candidate was generated because you opted in. It is a guess, not a found or verified address.");
    }
  }
  if (!contacts.some((c) => c.type === "email" && c.label === "professional" && c.verification === "published_unverified")) {
    notes.push("No person-specific published email was found on the pages checked; any generated candidate remains unverified.");
  }
  if (!contacts.some((c) => c.type === "phone")) notes.push("No usable public phone number was found on the pages checked.");
  notes.push("Publicly listed company numbers are not assumed to be personal mobile numbers. Phone line type was not independently verified.");

  const result: PublicDiscoveryResult = { contacts, pagesVisited, notes, domain };
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  if (cache.size > 5_000) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  return result;
}
