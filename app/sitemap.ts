import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/** Public marketing routes only; signed in and shared pages are not indexable. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: siteUrl("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: siteUrl("/terms"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
