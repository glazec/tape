import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BlogShell } from "@/components/blog/blog-shell";
import { SITE_NAME, siteUrl } from "@/lib/site";

const DESCRIPTION =
  "Product notes and practical thinking from Tape, the AI meeting note taker that turns conversations into searchable team memory.";

export const metadata: Metadata = {
  title: "Blog",
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    url: siteUrl("/blog"),
    siteName: SITE_NAME,
    title: "Tape Blog",
    description: DESCRIPTION,
  },
};

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <BlogShell>{children}</BlogShell>;
}
