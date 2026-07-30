import { createImageUrlBuilder, type SanityImageSource } from "@sanity/image-url";
import { defineQuery, type PortableTextBlock } from "next-sanity";
import { cache } from "react";

import { sanityClient } from "./client";

const BLOG_REVALIDATE_SECONDS = 300;

const blogImageProjection = `{
  _type,
  alt,
  caption,
  crop,
  hotspot,
  asset->{
    _id,
    url,
    metadata {
      lqip,
      dimensions {
        width,
        height,
        aspectRatio
      }
    }
  }
}`;

const BLOG_POSTS_QUERY = defineQuery(`*[
  _type == "post" &&
  defined(slug.current) &&
  defined(publishedAt) &&
  publishedAt <= now()
] | order(publishedAt desc) {
  _id,
  title,
  "slug": slug.current,
  excerpt,
  publishedAt,
  "mainImage": mainImage ${blogImageProjection}
}`);

const BLOG_POST_QUERY = defineQuery(`*[
  _type == "post" &&
  slug.current == $slug &&
  defined(publishedAt) &&
  publishedAt <= now()
][0] {
  _id,
  title,
  "slug": slug.current,
  excerpt,
  publishedAt,
  "mainImage": mainImage ${blogImageProjection},
  "body": body[] {
    ...,
    _type == "image" => ${blogImageProjection}
  }
}`);

export type BlogImage = {
  _type: "image";
  alt?: string | null;
  caption?: string | null;
  crop?: {
    _type?: "sanity.imageCrop";
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null;
  hotspot?: {
    _type?: "sanity.imageHotspot";
    x: number;
    y: number;
    height: number;
    width: number;
  } | null;
  asset?: {
    _id: string;
    url: string;
    metadata?: {
      lqip?: string | null;
      dimensions?: {
        width: number;
        height: number;
        aspectRatio: number;
      } | null;
    } | null;
  } | null;
};

export type BlogPostSummary = {
  _id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  publishedAt: string;
  mainImage?: BlogImage | null;
};

export type BlogPost = BlogPostSummary & {
  body?: Array<PortableTextBlock | BlogImage> | null;
};

const imageBuilder = createImageUrlBuilder(sanityClient);
const requestOptions = {
  next: { revalidate: BLOG_REVALIDATE_SECONDS },
} as const;

export async function getBlogPosts() {
  return sanityClient.fetch<BlogPostSummary[]>(
    BLOG_POSTS_QUERY,
    {},
    requestOptions,
  );
}

export const getBlogPost = cache(async (slug: string) => {
  return sanityClient.fetch<BlogPost | null>(
    BLOG_POST_QUERY,
    { slug },
    requestOptions,
  );
});

export function blogImageUrl(
  image: BlogImage,
  {
    width,
    height,
    fit = height ? "crop" : "max",
  }: {
    width: number;
    height?: number;
    fit?: "crop" | "max";
  },
) {
  let builder = imageBuilder
    .image(image as SanityImageSource)
    .width(width)
    .fit(fit)
    .auto("format")
    .quality(84);

  if (height) {
    builder = builder.height(height);
  }

  return builder.url();
}

export function formatBlogDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
