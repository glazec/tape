# Meeting conversation intelligence

Status: Proposal

Implementation: Not scheduled

## Product goal

Help a colleague answer five questions immediately after a meeting:

1. What did we spend time discussing?
2. How deeply did we examine each proposal?
3. Which proposals reached a decision?
4. Was the meeting productive for the time spent?
5. Did the other participants show interest in the discussion, in working with us, and in continuing a relationship?

The transcript remains the source record. Every generated topic, proposal, decision, and interest signal must link to supporting transcript segments.

## Proposed experience

Add a collapsed `Conversation intelligence` section near the meeting player. Opening it shows:

1. A compact readout for focused discussion, deep discussion, decisions, and follow ups.
2. A conversation map showing how far each topic progressed over time.
3. A proposal ledger with time, depth, status, owner, and next step.
4. A counterparty interest panel with confidence and transcript evidence.

Selecting any map segment, proposal, decision, or signal seeks the recording and scrolls to the supporting transcript.

## Measurement model

### Focus

Focus rate is focused discussion time divided by analyzable meeting time.

Classify transcript windows as proposal discussion, decision work, relevant context, rapport, tangent, repetition, or silence. Show this composition so the result is explainable.

Speaking speed and question frequency are supporting signals. They should not determine focus by themselves.

### Depth

Depth measures how far the conversation progressed on a topic. It is not a personality judgment or a proxy for meeting length.

| Level | Meaning | Example |
| --- | --- | --- |
| Context | The topic is introduced or described | Self introduction or product overview |
| Mechanics | The parties examine how it works | Workflow, actors, dependencies, or process |
| Evidence | Claims are tested against concrete facts | Unit economics, metrics, examples, assumptions, or constraints |
| Challenge | The parties probe tradeoffs, failure modes, and alternatives | Repeated follow up questions on one assumption |

For each topic, show:

1. The deepest level reached.
2. Time spent in Evidence and Challenge.
3. The longest related follow up chain.
4. Evidence anchors such as metrics, customers, economics, risks, and alternatives.

Decision status stays separate from depth. A quick decision can be shallow, while deep analysis can correctly remain open.

### Efficiency

Do not show one unexplained efficiency score. Show the observable components:

1. Focused discussion time.
2. Rapport and tangent time.
3. Repeated discussion time.
4. Proposals closed or advanced.
5. Formal decisions made.
6. Actions with an owner and next step.

### Proposal accounting

For every proposal, record:

1. Title and concise description.
2. First mention and final discussion timestamps.
3. Active discussion duration, excluding unrelated conversation between mentions.
4. Deepest level, deep discussion time, follow up chain, and evidence segments.
5. Status: decided, rejected, deferred, open, or follow up.
6. Decision, rationale, owner, and next step when present.

Overlapping proposal windows must not double count meeting time.

### Counterparty interest

Tape cannot know whether someone privately likes us. It can estimate observable relationship interest through three separate dimensions:

1. Discussion interest: substantive questions, voluntary elaboration, challenges, and sustained participation.
2. Interest in working with us: offers to help, requests for access, shared resources, and concrete next steps.
3. Relationship momentum: willingness to reconnect, make introductions, or exchange opportunities.

Show confidence and supporting moments for every dimension. Do not present a precise likeability percentage or claim a hidden emotional state.

## Real meeting prototype

The initial mockup used the Greenfield and IOSG meeting from July 22, 2026.

| Observed data | Result |
| --- | --- |
| Transcript | 27:06 and 364 segments |
| Talk balance | Claude 58 percent and Yiping 42 percent |
| Proposal areas | 5 |
| Formal decisions | 0 |
| Explicit follow ups | 3 |
| Prototype focused discussion | 93 percent |
| Prototype Evidence and Challenge time | 11:06 |
| Substantive counterparty questions | 10 |

The focus and depth results are prototype semantic classifications, not stored production fields. They require calibration before product use.

Strong observable interest signals included asking whether Tape was already built, asking for the GitHub repository, offering to improve it, describing the proposals as interesting, and agreeing to share relevant companies and keep the relationship active.

### Proposal time

| Proposal | Window | Active time |
| --- | --- | --- |
| Shopagentic | 8:22 to 14:23 | 6:01 |
| Open source Tape | 14:24 to 20:15 | 5:51 |
| Contacts layer versus MCP | 20:15 to 23:38 | 3:23 |
| Automated screening | 23:38 to 25:20 | 1:42 |
| Shared deal flow and Trade | 25:26 to 27:03 | 1:37 |

## Mockup structure

```text
Conversation intelligence

Focused discussion     Deep discussion     Decisions     Follow ups
93 percent             11:06               0             3

Conversation map
Context -> Mechanics -> Evidence -> Challenge

Proposal ledger
Proposal | Time | Depth | Status | Evidence

Counterparty interest
Discussion interest | Interest in working with us | Relationship momentum
```

The default view should stay compact. Detailed classifications, model confidence, and evidence appear only after the colleague expands the section.

## Future delivery outline

1. Define the analysis data contract and a labeled evaluation set.
2. Compute deterministic measures such as talk time, silence, questions, topic windows, and explicit actions.
3. Add structured model extraction with transcript segment identifiers, confidence, prompt version, and model version.
4. Add the collapsed meeting view and transcript seeking.
5. Calibrate on at least 30 diverse meetings before enabling comparisons across meetings.

## Acceptance criteria

1. Every proposal, decision, and interest signal has supporting transcript segment identifiers.
2. Depth is independent from decision status.
3. The product does not present a precise enjoyment or likeability score.
4. Proposal time does not double count overlapping windows.
5. Reviewers reach at least 85 percent agreement on proposal boundaries and decision status across 30 meetings.
6. Analysis access follows the meeting permission boundary.
7. The transcript and media load independently if analysis fails.
8. Speaking speed is normalized by language and used only as context.

## Guardrails

1. Do not use these measures as individual employee performance grades.
2. Compare meetings only within similar meeting types and languages.
3. Show confidence and evidence for model generated interpretations.
4. Preserve the transcript as the authoritative record.
