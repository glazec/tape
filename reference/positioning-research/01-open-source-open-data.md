# Raw Research: Open Source / Open Data Positioning

Research date: 2026-07-28. Sources: Hacker News launch threads, r/selfhosted, r/opensource-adjacent subs, r/productivity comparison threads, LinkedIn/Mastodon, press (The Verge, AP syndicated).

## 1. Key Findings

### Finding 1: The open-source meeting-notes category has real, measurable traction — but concentrated in technical communities

- **Hyprnote** (YC S25) got a front-page Launch HN (July 2025) with heavy engagement; the project (now split into `char` + open-source `anarlog`) sits at ~8.9k GitHub stars (July 2026).
- **Meetily** went from ~4.5k to 11k+ GitHub stars by mid-2026 and is repeatedly on GitHub trending; its r/selfhosted launch posts are among the most engaged meeting-tool posts on the sub.
- **Vexa** (Apache-2.0 meeting-bot API, 1.7k+ stars), **Amurex**, **Scriberr**, **zabt-ai**, **Backchannel**, **Nojoin**, **ownscribe** — the space is now crowded with open entrants, itself a demand signal.
- The question "Is there a self-hosted alternative to Otter.ai?" recurs on r/selfhosted from 2021 through late 2025 — a persistent, unfilled ask.

### Finding 2: The #1 demand driver is NOT open source per se — it's distrust of cloud recording bots

Across every channel, the emotional energy centers on: bots joining uninvited, consent violations, voiceprints, legal discovery, and corporate IT bans.

- HN "Tell HN: Otter.ai bot recording meetings without consent" (2022) — an early, high-visibility grievance.
- An AP-syndicated piece (July 2026) quotes an HR-certification CEO: "There are huge risks to the organization on AI notetakers… I don't think companies should use it at all," and a Baker Donelson attorney warning that shared transcripts can destroy attorney-client privilege.
- LinkedIn (Apr 2026, security practitioner Nick Route): "I am really starting to dislike AI notetakers and see them as a huge cyber security risk… two AI notetakers joined. Did the owner ask permission? No." A commenter described an "Otter outbreak — an infestation" spreading through a workplace via viral transcript links.
- 2026 Reddit meta-reviews of the category consistently note corporate IT departments banning Otter/Fireflies/Read AI, pushing users to bot-free/local tools (Granola, Jamie) — note that mainstream users solve this with *closed* local tools, not open ones.

**Drivers ranked by observed intensity:** (1) bot/consent/compliance distrust → (2) data ownership & lock-in → (3) privacy/regulated-industry requirements (HIPAA, GDPR, legal privilege, defense) → (4) cost ($10–30/user/mo fatigue) → (5) open source as *proof mechanism* for the above.

### Finding 3: "Open data" grievances are concrete, recent, and viral — this is the sharpest angle

- **Fireflies transcript ransom (Jan–Feb 2026, LinkedIn + Medium, widely shared):** Fireflies retroactively paywalled transcripts beyond 800 minutes with no warning — and grayed out batch-delete behind the same paywall. "I refuse to pay a ransom for my notes… Accessing your own meeting notes isn't a premium feature. It's the core value proposition… Charging for access to them is tantamount to extortion." (Sam Liberty)
- **Fireflies free plan:** transcripts deleted after 7 days; downloads require paid plan. Forum user (July 2026): "If you don't control the backup, you don't control the data" — he wrote a script to archive transcripts to his NAS.
- **Otter:** bulk export locked to paid plans (Reddit, Dec 2024: "I was trying to archive my hundreds of old recordings but was told bulk export is for subscribed users"); r/podcasting (2022) users furious Otter "lock[ed] free users out of recordings they'd previously PAID for."
- **Granola link-sharing scandal (The Verge, Apr 2026):** notes viewable by "anyone with the link" by default, AI training opt-out by default for non-enterprise; at least one major company barred an executive from using it. A Hyprnote HN commenter discovered Granola "automatically making each of my notes folders *public to the entire organization*."
- Granola export friction shows up in r/ObsidianMD / r/NoteTaking threads — users bolt on plugins to get recordings/transcripts out into their vaults; Hyprnote HN commenters explicitly asked for plain Markdown export to a folder of their choice instead of a SQLite blob.

### Finding 4: HN launch threads — what openness actually buys you, and where it backfires

- **Hyprnote Launch HN (July 2025):** praise — "super cool & kudos for making it local-first & open-source" (mentalgear); one user "cancelled fireflies.ai subscription yesterday" (anyg); resonated with people whose employers banned recorders. Criticism — GPL license flagged as a *blocker* for workplace adoption (hidelooktropic); commenters caught the contradiction between "no data leaves your machine" and bundled PostHog/Sentry telemetry; non-functional speaker diarization called "a show stopper" (ljosa); fake enterprise logos torched the founders' credibility.
- **Meetily Show HN (Feb 2025):** near-zero engagement (4 comments) despite perfect topical fit — open source alone doesn't guarantee attention; the Reddit r/selfhosted channel worked far better for it ("Finally, a meeting tool that doesn't require me to trust a VC-backed startup with my company's confidential strategy discussions").
- **Granola:** never had a big Launch HN; sentiment among mainstream reviewers is strongly positive (9.5/10 Reddit sentiment in category roundups) *despite* being closed — because it solved the bot problem. Its 2026 privacy scandal is now the counter-example open competitors cite. An "Open-source granola" HN post (June 2025) drew instant code-audit scrutiny: "great that its open-source but checked out your repo and bro security needs to be much better please; don't read my data."
- **Fathom:** no substantive launch thread found; earns goodwill precisely on an open-data-adjacent behavior — "Fathom emails the notes and transcripts to everyone in the meeting. You don't have to sign up" (Liberty, Feb 2026) — but is criticized for no self-host option and default video recording.

### Finding 5: Mainstream (r/productivity-type) buyers barely mention open source

In the large 2026 Reddit comparison meta-threads (Granola vs Otter vs Fireflies vs Fathom), decision criteria are: bot vs no-bot, note quality, price, CRM sync, Windows support. "Open source" appears almost nowhere; "local," "private," and "my company banned X" appear constantly. Open source is a *developer-channel* wedge, not a mainstream feature.

## 2. Demand Signal Strength

| Positioning angle | Audience | Signal |
|---|---|---|
| Local-first / no-bot / privacy | Broad (incl. mainstream, enterprise IT) | **Strong** — the dominant category narrative of 2025–26 |
| Open data: export everything, plain files, no ransom | Broad, sharpened by Fireflies/Otter/Granola incidents | **Strong and rising** — concrete villains exist |
| Open source (auditable, forkable, self-hostable) | Developers, r/selfhosted, HN, regulated industries | **Moderate-to-strong** in-channel; **weak** with mainstream buyers |
| Self-hosting as a requirement | Regulated/air-gapped orgs, homelab | **Moderate** — passionate niche; most users want local *app*, not ops burden |
| Cost savings vs $10–30/seat SaaS | SMB, journalists, freelancers | **Moderate** — real but commoditized |

## 3. Representative Quotes

1. "We used Otter/Fireflies/Fathom for years — until we realized we were handing over years of private meeting data to a black box." — r/selfhosted, "How I Replaced Otter/Fireflies with a Self-Hosted Stack" (May 2025)
2. "I refuse to pay a ransom for my notes… The batch delete function is ALSO locked behind a paywall!" — LinkedIn/Medium, on Fireflies (Jan 2026)
3. "Because if you don't control the backup, you don't control the data." — Stackinsight forum, on Fireflies 7-day free-tier retention (Jul 2026)
4. "Finally, a meeting tool that doesn't require me to trust a VC-backed startup with my company's confidential strategy discussions." — r/selfhosted, Meetily launch reception (2025)
5. "super cool & kudos for making it local-first & open-source" / "cancelled my fireflies.ai subscription yesterday because it just felt unnecessary" — HN, Hyprnote Launch HN (Jul 2025)
6. "[Granola was] automatically making each of my notes folders *public to the entire organization*" — HN commenter eawgewag, Hyprnote thread (Jul 2025)
7. "Every meeting-AI tool you can buy sends your conversations to *their* cloud and rents you access back." — Vexa README/Reddit posts (2025–26)
8. "There are huge risks to the organization on AI notetakers… I don't think companies should use it at all." — HRCI CEO, AP-syndicated (Jul 2026)
9. "The inability to tell who said what is a show stopper." — HN ljosa on Hyprnote — a warning that openness doesn't excuse missing table-stakes features
10. "great that its open-source but checked out your repo and bro security needs to be much better please" — HN, "Open-source granola" thread (Jun 2025) — open source invites audit, and you must survive it

## 4. Verdict

"Open source / open data" is a genuinely winnable position for a new entrant, but the winning formulation is **"your meetings are yours — local capture, plain exportable files, no bot, no ransom"** with open source serving as the *proof* rather than the headline, because the loudest and fastest-growing anger in this market is about lock-in and consent (Fireflies' transcript paywall, Otter's export gates, Granola's public-link defaults), not about license files. The strategy has a proven adoption channel (HN + r/selfhosted + GitHub trending drove Meetily to 11k stars and Hyprnote through YC) and a defensible enterprise endgame (regulated industries that IT departments are actively steering away from Otter/Fireflies), but it demands flawless integrity — Hyprnote's telemetry contradiction and GPL choice show that technical audiences will publicly punish any gap between the openness claim and the code. The main risk is that mainstream buyers choose on no-bot UX and note quality (closed Granola won them without openness), so open source/open data should be positioned as the trust-and-exit-rights layer on top of a product that first matches SaaS polish — "as good as Granola, but the data is yours and the code proves it."
