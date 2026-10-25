# WebOrigin Lead Finder

Free-tier-first lead management and professional contact discovery for legitimate business outreach.

## Current MVP

- Next.js App Router + TypeScript dashboard
- LinkedIn profile URL validation and lookup form
- Browser-local lead saving, search, status updates and deletion
- CSV import/export and sequential bulk enrichment of imported profiles with a LinkedIn URL and company-domain column
- Email and phone fields with provider/source attribution
- Supabase schema with row-level security for the next persistence/auth stage
- Free-first public company website discovery for published professional emails and public phone numbers
- Optional self-hosted SearXNG metasearch for broader public-web snippets, with low confidence and source attribution
- Source URL, evidence excerpt, confidence and contact evidence type displayed for each discovery
- In-memory 30-minute result cache, robots.txt handling, per-host pacing, page-size/time limits and basic SSRF/private-address safeguards
- Optional Tomba fallback gated by an explicit environment flag

## Free public-source lookup

In the lookup form, enter the LinkedIn URL plus the person's name (optional) and the company's official domain (for example, `example.com`). For batch work, import a CSV with columns such as `name`, `linkedin url`, `company`, and `company domain`, then use **Enrich N profiles** above the lead table. Bulk jobs run sequentially in the open browser tab; keep it open until the completion notice appears. The free adapter checks the public homepage and a small set of contact/about/team/leadership pages, subject to `robots.txt`. It extracts company-domain emails and publicly listed phones, returns source links and evidence snippets, and caches results in memory for 30 minutes.

A public phone number is conservatively labelled as a company number; WebOrigin does not infer that it is someone's direct mobile. A guessed `first.last@domain` candidate is optional, explicitly marked as a guess, and not mailbox-verified. No LinkedIn profile page is scraped.

For broader searches, optionally run the included local SearXNG setup (Docker required). From PowerShell, in the repository root:

```powershell
Copy-Item searxng/.env.example searxng/.env
# Open searxng/.env and replace SEARXNG_SECRET with a strong random value.
docker compose --env-file searxng/.env -f searxng/docker-compose.yml up -d
```

Then add this line to the **root** `.env.local` file (not the nested SearXNG env file) and restart Next.js:

```dotenv
SEARXNG_BASE_URL=http://localhost:8080/
```

The included `searxng/settings.yml` enables JSON results, which WebOrigin needs. The container's port is bound to `127.0.0.1` only. Stop it with `docker compose --env-file searxng/.env -f searxng/docker-compose.yml down`. See the [official Docker installation guide](https://docs.searxng.org/admin/installation-docker) for maintenance details. WebOrigin queries its JSON search endpoint for the person's name/company and extracts contacts only from relevant result snippets. Configure your SearXNG `search.formats` to include `json`; the official [Search API documentation](https://docs.searxng.org/dev/search_api.html) notes that JSON format may be disabled on some instances. Search snippets have lower confidence than contacts extracted from an official company page and must be opened and checked. This uses SearXNG as a separate service; WebOrigin does not copy its AGPL code.

The crawl has request timeouts, a per-page size cap, same-host redirect handling, per-host pacing, and basic checks against private/local IP addresses. It is deliberately disabled in production until authentication, durable per-user quotas, and abuse controls are implemented.

### Optional wider public-web search

WebOrigin can query an operator-run [SearXNG](https://github.com/searxng/searxng) metasearch service without a proprietary search API key. This is optional; when not configured, the official-company-site crawler still works. Follow the [official SearXNG Docker installation guide](https://docs.searxng.org/admin/installation-docker), then set the base URL in `.env.local`:

```dotenv
SEARXNG_BASE_URL=http://localhost:8080/
```

Ensure the SearXNG instance enables JSON results in its `search.formats` setting; otherwise its API can return 403. WebOrigin uses two short queries when a person's name is supplied, takes up to eight results per query, and labels any contact found in search snippets as lower-confidence and unverified. Search providers can rate-limit queries, and operating a self-hosted instance still requires a machine/network connection.

### Optional provider fallback

Tomba is disabled by default, even if credentials are present. To opt into it for local testing, set `ENABLE_TOMBA_FALLBACK=true` in `.env.local` and configure the Tomba key/secret below. Phone enrichment may consume credits. Never expose keys in browser code.

## Run locally (Windows PowerShell)

Requirements: Node.js 20.9+ and Git.

```powershell
git clone https://github.com/Sunder-Chauhan/weborigin-lead-finder.git
cd weborigin-lead-finder
npm install
Copy-Item .env.example .env.local
```

For live contact lookup in local development, create a Tomba API key and secret in its dashboard, then fill these in `.env.local`:

```dotenv
# Only set true when you explicitly accept provider usage/credit costs.
ENABLE_TOMBA_FALLBACK=true
TOMBA_API_KEY=your_key
TOMBA_API_SECRET=your_secret
```

Then start the app:

```powershell
npm run dev
```

Open http://localhost:3000 and paste a LinkedIn profile URL.

**Important:** The provider call is intentionally limited to local development. The public production endpoint returns a disabled response until Supabase authentication, per-user quotas, abuse controls, and usage tracking are implemented. Do not remove this guard merely to deploy the app; it prevents an unauthenticated public endpoint from consuming your provider credits.

## Contact data coverage and costs

The Tomba adapter calls its documented LinkedIn finder endpoint and asks for mobile enrichment. Results depend on provider coverage; a missing result stays missing. Phone enrichment can have additional credit costs. Tomba's free allowance and endpoint charges can change, so check the current plan and usage dashboard before live or bulk tests. The app does not bypass quotas, rotate accounts, or retry against alternate credentials.

The code keeps the provider credentials server-side. Never place `TOMBA_API_KEY` or `TOMBA_API_SECRET` in a `NEXT_PUBLIC_*` variable or commit `.env.local`.

## Verification and CI

GitHub Actions runs ESLint and a Next.js production build on pushes and pull requests to `main`.

## Open-source references and implementation notes

WebOrigin uses a native implementation of common public-source discovery patterns and does not copy application source from AGPL projects into this repository. Research references include [OpenLeads](https://github.com/Samyrrrrrr990/openleads) (public-source discovery and evidence tiers), [OpenEnrich](https://github.com/openenrich/openenrich) (local email finding/verification concepts), [LeadForge](https://github.com/AbdulrahmanAmer/leadforge) (public business website crawling; MIT license), and [OpenProspector](https://github.com/clawnify/OpenProspector) (cache-first provider waterfalls). Their licenses and terms should be reviewed before directly incorporating any source code.

## Open-source enrichment research

See [OPEN_SOURCE_ENRICHMENT_RESEARCH.md](./OPEN_SOURCE_ENRICHMENT_RESEARCH.md) for a review of open-source candidates, license considerations, and the recommended free-first architecture. The key limitation is that free public sources can discover published email and company contact numbers, but cannot guarantee a person's hidden direct mobile from a LinkedIn URL.

## Next implementation stages

1. Supabase Auth login and user-isolated lead persistence.
2. Server-side usage tracking, rate limits, caching and monthly free quotas.
3. Durable shared caching, retries/backoff and test coverage for public-source discovery.
4. Optional authorized phone-enrichment adapters behind the same interface.
5. Billing and paid plans only after lookup accuracy and operating costs are measured.

## Honest contact coverage

A LinkedIn URL alone does not expose hidden email addresses or mobile numbers. Results depend on public data, user-supplied records, and authorized providers. The app should distinguish direct numbers from company switchboards and show source/verification status.

This project will not scrape restricted LinkedIn data or bypass SignalHire or any other provider's authentication, credits, rate limits, or access restrictions.

## Supabase schema

Review `supabase/schema.sql` before running it in the Supabase SQL Editor. The UI currently uses browser-local storage; the SQL schema is groundwork, not yet connected to the screen.

## Privacy and compliance

Only collect and use professional contact information for a legitimate purpose. Respect provider contracts, website terms, applicable privacy law, outreach rules, retention policies, and deletion requests.
