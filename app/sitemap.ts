import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";
import { getBlogPosts } from "@/sanity/posts";

/** Public marketing routes only; signed in and shared pages are not indexable. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogPosts();

  return [
    { url: siteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: siteUrl("/blog"), changeFrequency: "weekly", priority: 0.7 },
    ...posts.map((post) => ({
      url: siteUrl(`/blog/${post.slug}`),
      lastModified: post.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: siteUrl("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: siteUrl("/terms"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
