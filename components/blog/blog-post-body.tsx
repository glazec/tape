import type { ReactNode } from "react";
import { PortableText, type PortableTextComponents } from "next-sanity";

import { BlogBodyImage } from "@/components/blog/blog-image";
import type { BlogImage, BlogPost } from "@/sanity/posts";

const components: PortableTextComponents = {
  block: {
    normal: ({ children }) => (
      <p className="mt-6 text-[1.0625rem] leading-8 text-pretty text-graphite">
        {children}
      </p>
    ),
    h2: ({ children }) => (
      <h2 className="font-display mt-14 text-display-3 tracking-[-0.02em] text-balance text-ink">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-10 text-xl font-medium tracking-[-0.015em] text-balance text-ink">
        {children}
      </h3>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-10 border-l-2 border-brand pl-6 font-display text-2xl leading-9 italic text-ink">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }) => (
      <ul className="mt-6 list-disc space-y-3 pl-6 text-[1.0625rem] leading-8 text-graphite marker:text-brand">
        {children}
      </ul>
    ),
    number: ({ children }) => (
      <ol className="mt-6 list-decimal space-y-3 pl-6 text-[1.0625rem] leading-8 text-graphite marker:text-brand-ink">
        {children}
      </ol>
    ),
  },
  marks: {
    link: ({
      children,
      value,
    }: {
      children: ReactNode;
      value?: { href?: string };
    }) => {
      const href = value?.href;

      if (!href) {
        return <>{children}</>;
      }

      const external = /^https?:\/\//.test(href);

      return (
        <a
          href={href}
          rel={external ? "noreferrer" : undefined}
          className="font-medium text-ink underline decoration-brand decoration-2 underline-offset-4 transition-colors hover:text-brand-ink"
        >
          {children}
        </a>
      );
    },
  },
  types: {
    image: ({ value }) => <BlogBodyImage image={value as BlogImage} />,
  },
};

export function BlogPostBody({ body }: { body: BlogPost["body"] }) {
  if (!body?.length) {
    return null;
  }

  return <PortableText value={body} components={components} />;
}
