# WebOrigin Lead Finder

Free-tier-first professional contact discovery for legitimate business outreach.

## Current status

This repository is initialized with the product plan and implementation guardrails. Next.js application files will be added in follow-up commits.

## Product goals

- Accept a LinkedIn profile URL or username.
- Discover professional email addresses and business phone numbers from permitted sources.
- Import and export lead lists via CSV.
- Save leads, source attribution, verification status, and lookup history.
- Add optional contact-enrichment providers through adapters.
- Later support free allowances and paid plans.

## Honest data coverage

A LinkedIn URL does not itself expose hidden email addresses or mobile numbers. Results depend on published company information, user-provided datasets, and providers the user is authorized to use. The app must show each result's source and verification status and must not fabricate missing values.

This project will not bypass SignalHire or any other provider's authentication, paid credits, rate limits, or access restrictions. It will not scrape restricted LinkedIn data or attempt to evade protections.

## Planned stack

- Next.js + TypeScript
- Supabase Postgres and Auth
- Vercel deployment
- Source adapters for permitted public information and optional authorized enrichment APIs

## Local setup (once the app files are committed)

```powershell
git clone https://github.com/Sunder-Chauhan/weborigin-lead-finder.git
cd weborigin-lead-finder
npm install
npm run dev
```

## Planned implementation stages

1. Dashboard, lead table, search/filter, and CSV import/export.
2. Supabase schema, authentication, and row-level security.
3. Public company-source discovery and provenance tracking.
4. Optional authorized email and phone enrichment adapters with quotas.
5. Lookup limits, billing integration, audit trail, and privacy controls.

## Privacy and compliance

Only collect and use professional contact information for a legitimate purpose. Respect website terms, provider contracts, applicable privacy law, outreach rules, retention policies, and deletion requests.