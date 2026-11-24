// Run with provider credentials: npx tsx scripts/eval-research-coverage.ts
// Fixtures are synthetic. Gold topics and source turns are never sent to the model.
import { generateMeetingFollowup } from "../lib/vendors/openrouter";

type Topic = {
  name: string;
  turn: number;
  qualifierTurn?: number;
  subject: RegExp;
  details: RegExp[];
};
type Fixture = {
  name: string;
  turns: string[];
  topics: Topic[];
  forbidden?: RegExp;
};
const fixtures: Fixture[] = [
  {
    name: "investment committee",
    turns: [
      "Could we map the leaders in each vertical AI sector? Rank the companies by valuation and revenue. A single industry wide ranking would hide important differences.",
      "Also identify newer entrants in those sectors where we can still invest at an attractive price.",
      "Which features let these applications defend against a general purpose model copying the product? We need case studies.",
      "Please put both slide decks in the shared folder tomorrow.",
      "We still need to investigate which layers of the agent stack capture value. Use companies with verified revenue in each layer.",
      "Look into what the chipmaker's investments and acquisitions reveal about its strategy over the next three years.",
      "One more question: how would fewer financing rounds for AI startups change competition among seed funds?",
      "Separately, how are venture firms changing the support they provide after investing as founders adopt agents?",
    ],
    topics: [
      {
        name: "sector map",
        turn: 0,
        subject: /sector|vertical|segment/i,
        details: [/lead|top.rank|dominant/i, /valuat/i, /revenue/i],
      },
      {
        name: "entry pricing",
        turn: 1,
        subject: /entrant|emerging|newer|early.stage|startup/i,
        details: [/pric|valuat/i],
      },
      {
        name: "defensibility",
        turn: 2,
        subject: /defen|protect|resist|differentiat|replicat|copy/i,
        details: [/general.purpose|foundation model/i],
      },
      {
        name: "agent stack",
        turn: 4,
        subject: /agent/i,
        details: [/layer/i, /value/i, /revenue/i],
      },
      {
        name: "chip strategy",
        turn: 5,
        subject: /chip|semiconductor/i,
        details: [/invest/i, /acqui/i],
      },
      {
        name: "seed competition",
        turn: 6,
        subject: /seed/i,
        details: [/compet/i, /round|financ|fundrais/i],
      },
      {
        name: "founder support",
        turn: 7,
        subject: /support|post.invest/i,
        details: [/agent/i],
      },
    ],
    forbidden: /slide deck|shared folder/i,
  },
  {
    name: "operations review",
    turns: [
      "Before we renew either of the two freight carriers, we need to know their damage rates on refrigerated routes.",
      "Is the dock backlog still open?",
      "No. We cleared the dock backlog yesterday and confirmed every shipment arrived.",
      "还有一个问题。客户退货是因为尺码不合适，还是因为面料有问题？请按原因比较退货率。",
      "The carriers also have different insurance deductibles. Include those in the damage comparison.",
    ],
    topics: [
      {
        name: "carrier comparison",
        turn: 0,
        qualifierTurn: 4,
        subject: /carrier|freight/i,
        details: [/damage/i, /refrigerat|cold.chain/i, /deductible/i],
      },
      {
        name: "return causes",
        turn: 3,
        subject: /return/i,
        details: [/siz|fit/i, /fabric|material/i, /rate/i],
      },
    ],
    forbidden: /backlog/i,
  },
  {
    name: "long service review",
    turns: [
      "Before renewing the support contract, compare overnight response times for phone and email.",
      "The uptime dashboard is on the screen.",
      "Yes, we can see it.",
      "Last month had four weekends.",
      "The dashboard uses local time.",
      "Understood.",
      "Could we check whether adding another reviewer improves defect detection enough to justify the extra cost?",
      "We do not yet have trials measuring reviewer accuracy.",
      "Let's move on to staffing.",
      "The roster has been circulated.",
      "The training dates are confirmed.",
      "What caused cancellations after the billing change? Break the rate out by monthly and annual subscribers.",
      "We know total subscriber counts, but the cancellation rates by plan remain unknown.",
      "The slides also mention the printer replacement.",
      "The replacement is complete.",
      "Returning to support: split the response time comparison by weekday and weekend.",
      "Everyone has access to the contracts.",
      "We can use the existing reports.",
      "One last research request. Do longer warranties reduce repair costs for refurbished devices?",
      "The warranty decision is still open.",
      "Please circulate the minutes.",
    ],
    topics: [
      {
        name: "support comparison",
        turn: 0,
        qualifierTurn: 15,
        subject: /response/i,
        details: [/phone/i, /email/i, /weekend/i],
      },
      {
        name: "reviewer economics",
        turn: 6,
        subject: /review/i,
        details: [/defect/i, /cost/i],
      },
      {
        name: "cancellation causes",
        turn: 11,
        subject: /cancel|churn/i,
        details: [/monthly/i, /annual/i, /bill/i],
      },
      {
        name: "warranty economics",
        turn: 18,
        subject: /warrant/i,
        details: [/refurbish/i, /repair/i, /cost/i],
      },
    ],
    forbidden: /printer|minutes/i,
  },
  {
    name: "resolved meeting",
    turns: [
      "Do we need to investigate last month's duplicate invoices?",
      "We matched every invoice to its payment. There were no duplicate payments, so the investigation is closed.",
      "Please send the reconciliation to finance.",
    ],
    topics: [],
  },
];

async function evaluate(fixture: Fixture) {
  const segments = fixture.turns.map((text, index) => ({
    id: `turn-${index + 1}`,
    speaker: index % 2 === 0 ? "Alex" : "Sam",
    startMs: index * 30000,
    text,
  }));
  const { research } = await generateMeetingFollowup({
    title: fixture.name,
    startedAt: null,
    segments,
  });
  const matched = new Set<number>();
  const missing = fixture.topics
    .filter((topic) => {
      const index = research.findIndex(
        (item) =>
          item.evidence.some((e) => e.segmentId === segments[topic.turn].id) &&
          (topic.qualifierTurn === undefined ||
            item.evidence.some(
              (e) => e.segmentId === segments[topic.qualifierTurn!].id,
            )) &&
          topic.subject.test(item.question) &&
          topic.details.every((pattern) =>
            pattern.test(item.question + " " + item.evidenceToCollect),
          ),
      );
      if (index >= 0) matched.add(index);
      return index < 0;
    })
    .map((topic) => topic.name);
  const unexpected = research.filter(
    (item, index) =>
      !matched.has(index) || fixture.forbidden?.test(item.question),
  );
  console.log(
    JSON.stringify({
      fixture: fixture.name,
      topics: fixture.topics.length,
      missing,
      unexpected: unexpected.map((item) => item.question),
      research: research.map(({question, evidenceToCollect, evidence}) => ({ question, evidenceToCollect, turns: evidence.map(e => e.segmentId) })),
    }),
  );
  return missing.length === 0 && unexpected.length === 0;
}

Promise.all(fixtures.map(evaluate))
  .then((results) => {
    if (!results.every(Boolean)) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
