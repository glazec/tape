import Link from "next/link";

import { BlogCoverImage } from "@/components/blog/blog-image";
import { BlogContainer } from "@/components/blog/blog-shell";
import { formatBlogDate, getBlogPosts } from "@/sanity/posts";

export const revalidate = 300;

export default async function BlogPage() {
  const posts = await getBlogPosts();

  return (
    <main>
      <section className="border-b border-ink/8">
        <BlogContainer className="py-20 sm:py-24 lg:py-28">
          <p className="font-mono text-label uppercase tracking-[0.2em] text-brand-ink">
            Tape journal
          </p>
          <h1 className="font-display mt-5 max-w-[13ch] text-display-1 tracking-[-0.025em] text-balance text-ink">
            Notes for meetings that keep{" "}
            <em className="italic text-brand">working.</em>
          </h1>
          <p className="mt-7 max-w-[52ch] text-lede text-pretty text-graphite">
            Product notes and practical thinking from the team building an AI
            meeting note taker for searchable team memory.
          </p>
        </BlogContainer>
      </section>

      <BlogContainer className="py-16 sm:py-20">
        {posts.length === 0 ? (
          <section
            aria-labelledby="empty-blog-heading"
            className="border-y border-ink/10 py-14"
          >
            <p className="font-mono text-label uppercase tracking-[0.18em] text-ash">
              First edition
            </p>
            <h2
              id="empty-blog-heading"
              className="font-display mt-4 text-display-3 tracking-[-0.02em] text-ink"
            >
              The journal is taking shape.
            </h2>
            <p className="mt-4 max-w-[48ch] text-[1.0625rem] leading-8 text-pretty text-graphite">
              Product lessons and field notes from building Tape will appear
              here soon.
            </p>
          </section>
        ) : (
          <ol className="border-t border-ink/10">
            {posts.map((post, index) => {
              const publishedDate = formatBlogDate(post.publishedAt);

              return (
                <li key={post._id} className="border-b border-ink/10">
                  <Link
                    href={`/blog/${post.slug}`}
                    className="group grid gap-8 py-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 sm:py-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)] lg:items-start"
                  >
                    {post.mainImage?.asset ? (
                      <div className="relative aspect-[8/5] overflow-hidden rounded-xl bg-mist">
                        <BlogCoverImage
                          image={post.mainImage}
                          sizes="(max-width: 1024px) calc(100vw - 3rem), 29rem"
                          className="transition-transform duration-500 ease-out group-hover:scale-[1.025]"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-[8/5] items-end rounded-xl bg-mist p-6">
                        <span className="font-display text-5xl italic text-brand/70">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0 lg:pt-2">
                      {publishedDate ? (
                        <time
                          dateTime={post.publishedAt}
                          className="font-mono text-label uppercase tracking-[0.16em] text-ash"
                        >
                          {publishedDate}
                        </time>
                      ) : null}
                      <h2 className="font-display mt-4 text-display-3 tracking-[-0.02em] text-balance text-ink transition-colors group-hover:text-brand-ink">
                        {post.title}
                      </h2>
                      {post.excerpt ? (
                        <p className="mt-4 max-w-[52ch] text-[1.0625rem] leading-8 text-pretty text-graphite">
                          {post.excerpt}
                        </p>
                      ) : null}
                      <span className="mt-7 inline-flex items-center gap-2 font-mono text-label uppercase tracking-[0.16em] text-ink">
                        Read article
                        <span
                          aria-hidden="true"
                          className="transition-transform group-hover:translate-x-1"
                        >
                          →
                        </span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </BlogContainer>
    </main>
  );
}
