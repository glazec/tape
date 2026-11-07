# Intel recipient evaluation

November 7, 2026. Local changes only.

Intel now answers whom to share with more reliably on the tested synthetic scenarios. It ranks current sharing value and displays the actual supporting or conflicting quote. This is evidence for a useful inexpensive baseline, not measured accuracy on the user's real meeting archive.

## Findings and changes

1. Notes previously removed uncited transcript turns. Two of the first three fixtures lost both the actual request and its reversal before scoring. Batching now preserves the full transcript alongside notes.
2. The original prompt judged relevance broadly. It ranked the right recipient first but still gave a person who explicitly declined further introductions 61.5 to 72 out of 100. The revised prompt asks whether sharing is useful now, respects explicit fulfillment and refusals, and gives later attributed transcript statements precedence over summaries.
3. Result text previously repeated a generic scale description. It now includes the selected original quote and date, plus any selected conflicting quote. Formatting uses existing evidence and adds no model request. This supports inspection but does not generate a custom explanation of a complex inferred synergy.

## Evaluation contract

The user approved the initial scenario: new Japan GPU capacity, Maya with a direct current request, Alex with a fulfilled need and refusal, and Ben with broad academic interest. Expected recipients must rank first and score at least 50; unsuitable recipients must score at most 25. Required requests and reversals must be cited. These thresholds test clear fixtures; they do not filter product results or represent calibrated probabilities.

The suite has three development variants and ten additional scenarios: geographic constraints, speaker attribution, Chinese, no suitable recipient, distinct people sharing a name, a later reversal for a confirmed identity, complementary offers, embedded instructions, selected intel source exclusion, and 25 participants with longer background across three batches. Each case must pass all its checks. The additional scenarios were initially held out from prompt development, then used to choose between prompt versions; they are no longer an untouched validation set.

## Measured comparison

All versions below use the same preserved transcript evidence and the same direct Jev model. The baseline comparison isolates scoring changes, not the earlier missing evidence bug.

| Version | Scenarios passing | Provider cost for 13 scenarios | Decision |
| --- | --- | --- | --- |
| Original scoring prompt | 3/13 | $0.004212012 | Reject: unsuitable recipients score too highly |
| Revised sharing prompt | 13/13 in each of 3 runs | $0.00471954 per run | Keep |
| Shortened sharing prompt | 12/13 | $0.00427434 | Reject: explicit Chinese request scores only 37.25 |

The retained version's three runs passed 39/39 scenario executions and 324/324 checks. Total reported cost was $0.01415862. Median scoring latency was 132 ms; maximum was 442 ms. The 25 person scenario cost $0.002967678 per run and took 373, 413 and 442 ms. These timings exclude retrieval, queueing, access rechecks, UI and database work. Repeated calls are not independent real world samples and may benefit from provider caching.

Cost is low in absolute terms, though the retained prompt costs about 12% more than the original on this suite. The shorter prompt saved about 9% compared with the retained version but lost quality. Full transcripts can increase cost on real archives and still encounter the existing size limit.

## Reproduction and evidence

Run `node --import=tsx scripts/eval-intel-recipients.ts` for evidence coverage. Run `node --env-file-if-exists=.env.local --import=tsx scripts/eval-intel-recipients.ts --live` with a valid configured credential for live scoring. The local credential returned HTTP 401 during this review; the existing service credential worked. Credentials were not printed, committed, or changed. The evaluation supplies an empty meeting usage scope and makes no database writes.

The current implementation is the retained version. Raw synthetic results include every output, individual check, cost and elapsed time:

1. [Original scorer](intel-recipient-baseline.jsonl)
2. [Retained run 1](intel-recipient-final-1.jsonl), [run 2](intel-recipient-final-2.jsonl), [run 3](intel-recipient-final-3.jsonl)
3. [Rejected shorter prompt](intel-recipient-compact-1.jsonl)
4. [Initial three case iteration](intel-recipient-initial.jsonl) and [expanded eleven case run](intel-recipient-expanded.jsonl)

The baseline prompt asked how relevant the person was and used levels from no supported connection to direct specific fit. The rejected compact prompt shortened the shared instructions while retaining the revised sharing scale. Results from earlier versions are historical artifacts, not expected snapshots of current output.

## Verification and limits

The broader Intel suite passed 116 tests; nine opt in database integration tests were skipped. TypeScript and focused lint passed. No deployment was performed.

This suite does not prove real archive relevance, production latency, end to end search success, or broad model accuracy. The long fixture contains repeated synthetic background, not a realistic confidential transcript. Future evaluation should add user judged examples with ambiguous interests and multi step synergies before making production quality claims. The source excerpts are grounded mechanically; their explanatory usefulness remains a human judgment.

## Main branch integration

Before release, newer main changes added stable workspace person identities and Luna extraction routing. The merge retains those changes. Scoring and source exclusion now use the candidate's exact segment membership instead of display names, including identical names within one meeting. Two focused regressions cover this boundary. The evaluation harness also resolves identities by exact segment membership.

The [merged live run](intel-recipient-merged.jsonl) passed 13/13 at $0.004763346. The full merged suite passed 2,454 tests with 106 opt in tests skipped; lint, TypeScript, migration consistency and the production build passed. This integration run supersedes the earlier cost for the final payload shape; earlier records remain comparisons from before integration.
