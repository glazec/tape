import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BlogCoverImage } from "@/components/blog/blog-image";
import { BlogPostBody } from "@/components/blog/blog-post-body";
import { BlogContainer } from "@/components/blog/blog-shell";
import { SITE_NAME, siteUrl } from "@/lib/site";
import { formatBlogDate, getBlogPost } from "@/sanity/posts";

export const revalidate = 300;

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    return { title: "Article not found", robots: { index: false } };
  }

  const description = post.excerpt || undefined;
  const url = siteUrl(`/blog/${post.slug}`);

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: SITE_NAME,
      title: post.title,
      description,
      publishedTime: post.publishedAt,
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const publishedDate = formatBlogDate(post.publishedAt);

  return (
    <main>
      <article>
        <BlogContainer className="py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-[50rem]">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 font-mono text-label uppercase tracking-[0.16em] text-graphite transition-colors hover:text-ink"
            >
              <span aria-hidden="true">←</span>
              All articles
            </Link>
            {publishedDate ? (
              <time
                dateTime={post.publishedAt}
                className="mt-12 block font-mono text-label uppercase tracking-[0.18em] text-ash"
              >
                {publishedDate}
              </time>
            ) : null}
            <h1 className="font-display mt-5 text-display-1 tracking-[-0.025em] text-balance text-ink">
              {post.title}
            </h1>
            {post.excerpt ? (
              <p className="mt-7 max-w-[52ch] text-lede text-pretty text-graphite">
                {post.excerpt}
              </p>
            ) : null}
          </div>

          {post.mainImage?.asset ? (
            <div className="relative mx-auto mt-12 aspect-[8/5] max-w-[68rem] overflow-hidden rounded-2xl bg-mist sm:mt-16">
              <BlogCoverImage
                image={post.mainImage}
                sizes="(max-width: 1216px) calc(100vw - 3rem), 68rem"
              />
            </div>
          ) : null}

          <div className="mx-auto mt-12 max-w-[44rem] border-t border-ink/10 pt-4 sm:mt-16">
            <BlogPostBody body={post.body} />
          </div>
        </BlogContainer>
      </article>
    </main>
  );
}
