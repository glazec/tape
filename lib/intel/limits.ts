// Scoring calls take about two minutes each, so a search with dozens of batches
// is bound by how many run at once. Planning is cheap (under a second for a
// 300 meeting archive); each in-flight step holds the accessible archive in
// memory, which the 1,000 meeting collection limit bounds.
export const INTEL_SEARCH_PARALLEL_BATCHES = 8;
// Shared by every running search, so two people searching still progress.
export const INTEL_SEARCH_TOTAL_PARALLEL_BATCHES = 16;
