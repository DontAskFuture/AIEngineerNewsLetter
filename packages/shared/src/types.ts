export const sourceCategories = [
  "lab_blog",
  "engineering_blog",
  "research_feed",
  "community_feed",
  "social_trends",
  "startup_launch",
  "docs",
  "pricing",
  "github",
] as const;

export const endpointKinds = ["rss", "sitemap", "html", "docs", "pricing"] as const;

export type SourceCategory = (typeof sourceCategories)[number];
export type EndpointKind = (typeof endpointKinds)[number];

export interface SourceEndpointSeed {
  kind: EndpointKind;
  url: string;
  cadenceMinutes: number;
  parserKey?: string;
}

export interface SeedSource {
  slug: string;
  name: string;
  description: string;
  category: SourceCategory;
  baseUrl: string;
  canonicalDomain: string;
  trustTier: number;
  endpoints: SourceEndpointSeed[];
}

export interface FetchSourceEndpointPayload {
  endpointId: number;
}

export interface ScoreDocumentsPayload {
  profileId: number;
  documentIds?: number[];
}

export interface SendDailyNewsletterPayload {
  newsletterDate: string;
}

export interface SendDailyAdminReportPayload {
  reportDate: string;
}
