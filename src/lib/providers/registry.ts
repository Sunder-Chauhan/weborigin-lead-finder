import type { ContactEnrichmentProvider } from "./types";

/**
 * Add provider adapters here after credentials, permitted use, quotas and
 * source attribution requirements have been checked. Keep keys server-only.
 */
export const contactProviders: ContactEnrichmentProvider[] = [];

export function enabledProviderNames() {
  return contactProviders.map((provider) => provider.displayName);
}
