import type { Metadata } from "next";

import { BrandedNotFound } from "@/components/branded-not-found";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <BrandedNotFound
      eyebrow="404 · Not found"
      title="This page is not on Tape."
      description="The link may be mistyped, or the page was moved or removed."
    />
  );
}
