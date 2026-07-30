import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBlogPost, getBlogPosts, notFound } = vi.hoisted(() => ({
  getBlogPost: vi.fn(),
  getBlogPosts: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@/sanity/posts", async () => {
  const actual = await vi.importActual<typeof import("@/sanity/posts")>(
    "@/sanity/posts",
  );

  return { ...actual, getBlogPost, getBlogPosts };
});

vi.mock("next/navigation", () => ({ notFound }));

vi.mock("next/image", async () => {
  const { createElement } = await import("react");

  return {
    default: ({ alt, src }: { alt: string; src: unknown }) =>
      createElement("img", {
        alt,
        src:
          typeof src === "string"
            ? src
            : (src as { src?: string } | null)?.src,
      }),
  };
});

import BlogPostPage, {
  generateMetadata,
} from "@/app/blog/[slug]/page";
import BlogPage from "@/app/blog/page";

const publishedPost = {
  _id: "post-1",
  title: "Why useful notes start before the meeting ends",
  slug: "useful-notes",
  excerpt: "A practical way to preserve decisions while context is still fresh.",
  publishedAt: "2026-07-29T12:00:00.000Z",
  mainImage: null,
};

describe("Sanity blog", () => {
  beforeEach(() => {
    getBlogPost.mockReset();
    getBlogPosts.mockReset();
    notFound.mockClear();
  });

  it("renders a useful empty state before the first post is published", async () => {
    getBlogPosts.mockResolvedValue([]);

    const html = renderToStaticMarkup(await BlogPage());

    expect(html).toContain("Notes for meetings that keep");
    expect(html).toContain("The journal is taking shape.");
  });

  it("links published posts from the blog index", async () => {
    getBlogPosts.mockResolvedValue([publishedPost]);

    const html = renderToStaticMarkup(await BlogPage());

    expect(html).toContain(publishedPost.title);
    expect(html).toContain('href="/blog/useful-notes"');
    expect(html).toContain("July 29, 2026");
  });

  it("renders a published Portable Text article and its metadata", async () => {
    getBlogPost.mockResolvedValue({
      ...publishedPost,
      body: [
        {
          _key: "paragraph-1",
          _type: "block",
          style: "normal",
          markDefs: [],
          children: [
            {
              _key: "span-1",
              _type: "span",
              marks: [],
              text: "Write the decision down while everyone still agrees.",
            },
          ],
        },
      ],
    });

    const props = { params: Promise.resolve({ slug: publishedPost.slug }) };
    const html = renderToStaticMarkup(await BlogPostPage(props));
    const metadata = await generateMetadata(props);

    expect(html).toContain(publishedPost.title);
    expect(html).toContain(
      "Write the decision down while everyone still agrees.",
    );
    expect(metadata.title).toBe(publishedPost.title);
    expect(metadata.alternates).toEqual({
      canonical: "https://tape.inevitable.tech/blog/useful-notes",
    });
  });

  it("returns the not found boundary for an unpublished slug", async () => {
    getBlogPost.mockResolvedValue(null);

    await expect(
      BlogPostPage({ params: Promise.resolve({ slug: "missing" }) }),
    ).rejects.toThrow("not-found");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
