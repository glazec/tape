import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Only the marketing surface is crawlable. Everything behind sign in, plus
 * shared meeting links, stays out of the index: those URLs are the access
 * boundary, so they must never turn up in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/auth/",
          "/dashboard",
          "/meetings/",
          "/settings",
          "/share/",
          "/share-card-preview",
          "/usage",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl("/"),
  };
}
