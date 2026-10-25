# WebOrigin Lead Finder

Free-tier-first lead management and professional contact discovery for legitimate business outreach.

## Current MVP

- Next.js App Router + TypeScript dashboard
- LinkedIn profile URL validation and lookup form
- Browser-local lead saving, search, status updates and deletion
- CSV import/export
- Email and phone fields with provider/source attribution
- Supabase schema with row-level security for the next persistence/auth stage
- Optional Tomba integration for LinkedIn profile email + mobile enrichment

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

## Open-source enrichment research

See [OPEN_SOURCE_ENRICHMENT_RESEARCH.md](./OPEN_SOURCE_ENRICHMENT_RESEARCH.md) for a review of open-source candidates, license considerations, and the recommended free-first architecture. The key limitation is that free public sources can discover published email and company contact numbers, but cannot guarantee a person's hidden direct mobile from a LinkedIn URL.

## Next implementation stages

1. Supabase Auth login and user-isolated lead persistence.
2. Server-side usage tracking, rate limits, caching and monthly free quotas.
3. Free public company-source email discovery and source attribution.
4. Optional authorized phone-enrichment adapters behind the same interface.
5. Billing and paid plans only after lookup accuracy and operating costs are measured.

## Honest contact coverage

A LinkedIn URL alone does not expose hidden email addresses or mobile numbers. Results depend on public data, user-supplied records, and authorized providers. The app should distinguish direct numbers from company switchboards and show source/verification status.

This project will not scrape restricted LinkedIn data or bypass SignalHire or any other provider's authentication, credits, rate limits, or access restrictions.

## Supabase schema

Review `supabase/schema.sql` before running it in the Supabase SQL Editor. The UI currently uses browser-local storage; the SQL schema is groundwork, not yet connected to the screen.

## Privacy and compliance

Only collect and use professional contact information for a legitimate purpose. Respect provider contracts, website terms, applicable privacy law, outreach rules, retention policies, and deletion requests.
