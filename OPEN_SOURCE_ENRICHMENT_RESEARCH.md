# Open-Source Enrichment Research & Recommended Architecture

**Reviewed:** 26 October 2026  
**Project:** WebOrigin Lead Finder  
**Target:** Find a professional email and, where lawfully/publicly available, a direct mobile number from a LinkedIn profile URL; target volume is at least 1,000 profiles/month with no mandatory paid API.

## Executive finding

There is no credible, general-purpose open-source repository found in this review that can reliably return **both a person's professional email and hidden direct mobile number from only a LinkedIn URL**, at 1,000 profiles/month, for free and without an underlying data source.

This is a data-coverage problem, not just a code problem. An open-source program can crawl public web pages, infer a company email pattern, validate an address, and normalize a phone number. It cannot reveal a number that is not published or otherwise present in a permitted data source. Commercial enrichment vendors have their own datasets and contracts; an open-source wrapper around them does not make their data or credits free.

The achievable zero-provider-cost baseline is:
- discover emails published on official company/team/contact pages;
- find a company's public main line and other published numbers, without mislabeling them as the person's mobile;
- optionally infer likely work-email formats when public evidence supports a pattern, always label the result as **inferred / unverified**;
- cache results and keep provenance so repeated profiles at the same company do not redo all work;
- use an authorized contact-data provider only as an optional last resort for unresolved personal/mobile fields.

There is no responsible way to promise 1,000 direct mobile numbers per month from public sources alone. The service can process 1,000 lookups, but the number of people with a usable published mobile will vary widely by source, market, and company.

## Repositories reviewed

### 1. OpenLeads — strong free public-source prospecting reference

Repository: https://github.com/Samyrrrrrr990/openleads

Its README describes a local lead-generation tool that searches public sources such as OpenStreetMap, Y Combinator, Hacker News, GitHub, OpenAlex, SEC EDGAR, Wikidata, and company sites. It distinguishes emails that were **found**, derived from a **pattern**, or merely **guessed**, rather than presenting all candidate addresses as verified. It also describes email checks using published addresses, MX/SPF/DMARC, Gravatar, and SMTP where available.

**Fit:** Useful reference for public-source discovery, source federation, email evidence tiers, cache, and honest confidence labels. It is not a hidden LinkedIn-to-mobile resolver, and the project README lists AGPL-3.0. Do not copy its code into a closed-source SaaS without reviewing the license obligations.

### 2. OpenEnrich — strong free local email-finding / verification engine

Repository: https://github.com/openenrich/openenrich

Its README describes a local email finder/verifier that crawls company websites, learns company email patterns from published addresses, generates candidates from a name plus company domain, and attempts SMTP verification where network conditions permit. It explicitly notes that SMTP checks can be inconclusive, especially for catch-all or restrictive mail servers. Optional provider adapters are used for rows that the free engine cannot resolve.

**Fit:** Best candidate to evaluate for a local email-enrichment sidecar or as a reference for a provider waterfall. It does not solve direct mobile discovery. Its package declares AGPL-3.0-only, so review the license before embedding or hosting a modified version as part of WebOrigin.

### 3. LeadForge — permissively licensed public-business/contact crawling reference

Repository: https://github.com/AbdulrahmanAmer/leadforge

The README describes a no-paid-API default pipeline that crawls public business listings and websites, extracts published contact details, estimates likely decision makers, and exports records with source evidence and confidence. The repository's LICENSE file declares MIT.

**Fit:** Of the reviewed full projects, this is the least restrictive license candidate to inspect for architecture and small reusable techniques. It is centered on finding business leads from public listings and company websites; that is not the same as finding a specific person's private/direct mobile from a LinkedIn profile. Review its dependencies and terms before reusing any component.

### 4. OpenProspector — useful architecture, not a zero-cost data source

Repository: https://github.com/clawnify/OpenProspector

Its README describes enrichment waterfalls, cache-first behavior, provider configuration, cost/credit tracking, result freshness, and per-attempt logs. Its own description emphasizes bringing your own provider keys; much of its personal contact coverage depends on external vendors.

**Fit:** Good design reference for pluggable providers, per-field cost tracking, caching, fallback ordering, and avoiding repeated spend. It does not make vendor mobile data free.

### 5. EmailFinder / small domain-pattern finders — useful only for narrow email tasks

Example: https://github.com/giuseppebaldini/email-finder

These tools generate possible name@domain formats and check DNS/SMTP. Their own README warns about false positives, personal email limitations, and catch-all servers.

**Fit:** Useful algorithmic ideas, but candidates must not be presented as confirmed addresses just because a mail server accepts them.

### 6. SearXNG — open-source metasearch for broader public-web discovery

Repository: https://github.com/searxng/searxng

SearXNG provides an HTTP search API whose `/search` endpoint supports a `q` query and selectable `format=json` when enabled by the instance configuration. Official documentation: https://docs.searxng.org/dev/search_api.html.

**Fit:** Useful optional search infrastructure for finding publicly indexed pages, without buying a proprietary search API key. It is not a contact database and it cannot guarantee indexed emails or phone numbers. We integrate with the API rather than copy SearXNG source; it remains a separate AGPL-licensed service.

### 7. Phone OSINT / reverse-lookup projects — wrong direction for this use case

Searches surfaced projects aimed at reverse lookup, caller ID, phone-number validation, and OSINT **starting from an already-known phone number**. These can identify line type/carrier or search information associated with a number. They do not generally solve the inverse problem of obtaining a person's unpublished number from a LinkedIn URL.

## Recommended WebOrigin architecture

### Stage A — free public-source baseline

Implement an independent source adapter that accepts:
- LinkedIn profile URL (for record identity only);
- person's name (optional but strongly helpful);
- company name and official website/domain (optional but strongly helpful).

The LinkedIn URL alone should not be treated as a source of hidden profile information. When no authorized resolver is configured, the UI should ask for a name/company/domain or clearly return “insufficient public input” instead of making up a result.

The public website adapter should:
1. Fetch only explicitly supplied, publicly accessible company domains; respect robots and site terms, use timeouts, cap response size, and rate-limit each host.
2. Inspect the home page and a small set of relevant internal pages linked as Contact, About, Team, Leadership, or People.
3. Extract published emails from visible text and mailto links, and published phones from visible text, tel links, and structured metadata.
4. Store the exact source URL and evidence excerpt for each result.
5. Distinguish **person-specific published email**, **role/shared inbox**, **company main phone**, and **person-specific published phone**. Do not label a company switchboard as a direct mobile.
6. Deduplicate and cache by normalized domain + page URL, with an expiry policy.
7. Make evidence visible: published, inferred, provider-returned, verified, invalid, and unknown must remain different statuses.

### Stage B — email pattern candidates, but honest status

Use patterns learned from real addresses on that company's public pages. If a person name and domain are known, candidates can be generated, but they remain **inferred/unverified** until meaningful evidence supports them. MX records only show that a domain can receive mail; SMTP results are often inconclusive and must not be described as guaranteed mailbox existence.

OpenEnrich is worth evaluating as a local email engine, but its AGPL license must be considered before integration into the public SaaS.

### Stage C — optional authorized enrichment waterfall

Keep Tomba and any later vendor behind the same adapter contract, but make paid lookups explicit and opt-in:
- cache before provider call;
- run free public-source checks first;
- call phone enrichment only when the user has enabled it and accepts the cost;
- track cost/credits per field and per profile;
- never rotate accounts or retry around provider quotas;
- never claim that a provider-returned phone is a verified personal mobile unless the provider supplies that evidence.

### Stage D — public SaaS safeguards

Before enabling production lookups, add authentication, server-side monthly quotas, abuse protection, an SSRF-safe website-fetching layer, data retention/deletion, and clear acceptable-use/privacy handling. Keep all provider keys server-side.

## Recommended decision

**Do not make OpenLeads or OpenEnrich the core dependency blindly.** Both are useful projects, but their AGPL licensing can create obligations for a public hosted service. Use LeadForge (MIT) as a permissively licensed architecture reference after dependency review, and implement a small WebOrigin-native free public-source adapter around our existing provider interface. Optionally run OpenEnrich as a separate local tool for evaluation rather than directly combining AGPL code into the app.

For personal/direct mobile coverage, retain an optional authorized provider. If the requirement is zero cost, the app should show “not publicly found” for people whose direct number is not available from permitted sources rather than inventing one. That is the only accurate free-first design.

## Source links

- OpenLeads: https://github.com/Samyrrrrrr990/openleads
- OpenEnrich: https://github.com/openenrich/openenrich
- LeadForge: https://github.com/AbdulrahmanAmer/leadforge
- OpenProspector: https://github.com/clawnify/OpenProspector
- Email Finder: https://github.com/giuseppebaldini/email-finder
- GitHub OSINT catalogue (for further discovery): https://github.com/osintshifu/awesome-osint-repos