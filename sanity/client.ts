import { createClient } from "next-sanity";

export const sanityProjectId =
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "bh7p20xg";
export const sanityDataset =
  process.env.NEXT_PUBLIC_SANITY_DATASET || "production";

export const sanityClient = createClient({
  projectId: sanityProjectId,
  dataset: sanityDataset,
  apiVersion: "2026-07-29",
  perspective: "published",
  useCdn: true,
});
