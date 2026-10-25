# WebOrigin Lead Finder

Free-tier-first lead management and professional contact discovery for legitimate business outreach.

## Current MVP

- Next.js App Router + TypeScript dashboard
- Single LinkedIn profile URL entry and validation
- Local lead saving, search, status updates and deletion
- CSV import/export
- Email and phone fields with source attribution fields
- Responsive UI and a server-side lookup endpoint placeholder
- Browser-local persistence for demo use

## Important current limitation

**Contact enrichment is not connected yet.** Adding a profile only saves it to the lead list. The lookup API intentionally returns `not_configured` until an authorized data-source adapter is implemented. No contact details are being retrieved or fabricated in the current MVP. Browser-local records are not shared across devices and are not a substitute for a production database.

## Stack

- Next.js 15.5.28, React 19, TypeScript
- Supabase client dependencies are included for the next persistence/auth phase
- Vercel-ready project structure

## Run locally (Windows PowerShell)

Requirements: Node.js 20.9+ and Git.

```powershell
git clone https://github.com/Sunder-Chauhan/weborigin-lead-finder.git
cd weborigin-lead-finder
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Next implementation stages

1. Add Supabase schema, authentication, and row-level security.
2. Implement permitted public-source discovery and source attribution.
3. Add optional authorized email and phone enrichment adapters.
4. Add provider usage meters, caching, retry policy and per-user product quotas.
5. Test contact match rates before describing coverage.
6. Add pricing/billing and deploy to Vercel after environment configuration.

## Honest contact coverage

A LinkedIn URL alone does not expose hidden email addresses or mobile numbers. Results depend on publicly published data, user-supplied records, and providers the app is authorized to use. The app must distinguish direct mobile numbers from company switchboards and show source and verification status.

This project will not bypass SignalHire or other providers' authentication, paid credits, rate limits, or access restrictions. It will not scrape restricted LinkedIn data or attempt to evade protections.

## Privacy and compliance

Only collect and use professional contact information for a legitimate purpose. Respect provider contracts, website terms, applicable privacy law, outreach rules, retention policies, and deletion requests. Never put secret API keys in `NEXT_PUBLIC_*` environment variables or commit `.env.local`.
