# Person page timeline eval

Tape extracts observations independently from the attributed lines in each meeting. The reducer groups them by topic, projects state in meeting date order and keeps history for material updates. Corrections and access are verified against the stored sources.

| Suite | Cases | Recorded result |
| --- | --- | --- |
| Main series | Repeated mobile language model interest, retries, Android benchmark, late Pixel import, pause and resume, a separate speech project, hiring, preferences, public focus and trust | 5/12 baseline, 9/12 first revision, 12/12 final |
| Named projects and parallel hiring | SDK rollout, similarly named initiatives, two hires, and a large group | 2/6 before iteration, 6/6 final |
| Mixed Chinese and English | Same project across languages, a repeated deployment, one line containing two projects, citable milestones and a public event | 2/4 before iteration, 4/4 final |

The baseline used the same extraction schema and reducer with a shorter prompt. Early prompt revisions split one named project by deliverable and sometimes treated a preference change as a new preference. The final prompt standardizes topic keys, distinguishes reconfirmations, captures parallel initiatives and keeps meeting dates and citation markers out of prose.

Example final state for the mobile language model project. The January Pixel 7 test stays in history even though it arrived after the April Android battery benchmark. The March restatement adds no milestone. The June resumption is current and the May pause remains in the history.

## Run

```sh
node --import=tsx scripts/eval-person-timeline.ts
node --env-file=.env.local --import=tsx scripts/eval-person-timeline.ts --live --baseline
node --env-file=.env.local --import=tsx scripts/eval-person-timeline.ts --live
node --env-file=.env.local --import=tsx scripts/eval-person-timeline.ts --holdout
node --env-file=.env.local --import=tsx scripts/eval-person-timeline.ts --multilingual
```

The first command uses expected decisions and runs offline. The live commands use Luna with fictional meetings and write no database records. Point `--env-file` to the provider environment file when running from a linked worktree. The cases are regression fixtures and were used during prompt iteration. They do not measure accuracy on real meetings or the quality of diarization.
