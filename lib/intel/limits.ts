// A Jev scoring call returns in one to two seconds even near its token limit
// (measured 2026-11-08), so a search loads the archive once and scores its
// batches in process, this many at a time.
export const INTEL_SEARCH_PARALLEL_BATCHES = 16;
// Searches running at once across all users; each holds one archive in memory,
// which the 1,000 meeting collection limit bounds.
export const INTEL_SEARCH_CONCURRENT_SEARCHES = 6;
