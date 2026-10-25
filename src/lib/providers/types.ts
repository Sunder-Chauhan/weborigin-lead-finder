export type ContactKind = "email" | "phone";
export type ContactVerification =
  | "unverified"
  | "syntax_valid"
  | "domain_valid"
  | "provider_verified"
  | "invalid";

export type DiscoveredContact = {
  type: ContactKind;
  value: string;
  label: "professional" | "direct" | "company_main" | "other";
  sourceName: string;
  sourceUrl?: string;
  verification: ContactVerification;
  confidence?: number;
  checkedAt?: string;
};

export type ProfileLookupInput = {
  linkedinUrl: string;
  fullName?: string;
  companyDomain?: string;
};

export type ProfileLookupResult = {
  provider: string;
  status: "complete" | "partial" | "not_found";
  contacts: DiscoveredContact[];
  notes?: string[];
};

/**
 * Implement only with sources whose terms and data rights permit this lookup.
 * Do not use this interface to bypass provider credits, authentication, or rate limits.
 */
export interface ContactEnrichmentProvider {
  readonly id: string;
  readonly displayName: string;
  lookup(input: ProfileLookupInput): Promise<ProfileLookupResult>;
}
