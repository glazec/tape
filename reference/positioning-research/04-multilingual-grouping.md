# Raw Research: Multilingual/Translation & Meeting Grouping

Research date: 2026-07-28. Method: 11+ web/social searches (Firecrawl, Exa) across Reddit, X-adjacent blogs, Chinese/Japanese/Taiwanese platforms, vendor forums.

## 1. Key Findings

### A. Multilingual / Native Translation

**1. The incumbents are structurally English-first, and users know it.**
- Otter supports only 6 languages (EN/ES/FR/DE/JA/ZH-simplified), several still "beta," **one language per meeting, no auto-detect, no mixed-language support** (Otter help center, May 2026: "Otter can only transcribe in one language at a time... you will need to select the associated language before the meeting"). Japanese was only added Nov 2025; Chinese later, in beta.
- Fathom covers ~28 languages via Whisper but is described by competitors and reviewers as "generic quality" for non-English. Granola's desktop app (macOS/Windows) **still does not support Mandarin** — Chinese is mobile-only (Granola docs; multiple Chinese reviews flag this: 新榜 review — "目前Granola电脑端还不支持转录中文，仅移动端支持").

**2. CJK users report quantitatively bad results and are actively churning.**
- Japanese benchmark (生成AI総合研究所, Jun 2026, same 5 Zoom meetings): **Notta 92% vs Otter 78%** on Japanese; on jargon-heavy meetings Otter fell to 65%. Verdict: Otter's Japanese output is "hard to distribute as minutes as-is."
- Chinese tech blogger (王尘宇, Jul 2026): "Otter的中文转写很拉胯，准确率大概只有六七成" (Otter's Chinese transcription is terrible, only ~60-70% accurate) — after two years as an Otter user, he now splits across 飞书妙记/通义听悟 for Chinese and keeps Otter only for English.
- Decopy review (2026): tested Otter on a Chinese-English product launch recording — "Chinese recognition accuracy was less than 50%."
- Korean: Otter and Descript **do not support Korean at all**; Korean-market comparisons tell readers to "skip Otter entirely."

**3. Code-switching (中英/日英/Konglish mixed meetings) is the sharpest unserved pain.**
- BibiGPT comparison page (Apr 2026), quoting a SaaS founder who churned from Granola: "我团队用了半年 Granola，发现中文会议摘要质量明显比英文差... 最后切到 BibiGPT" (used Granola 6 months; Chinese meeting summaries clearly worse than English; switched away). Their framing: "中英混合会议是英文工具的天然弱项" — mixed CN-EN meetings are the natural weak spot of English-first tools.
- Taiwanese review (aistoollab, Jul 2026) on Otter: "如果你的会议是中英夹杂的日常对话，准确度会掉" — accuracy drops on everyday Chinese-English code-switched meetings; advice repeated across TW/HK blogs is "record a real meeting and test before paying."
- A visible wave of open-source projects exists *specifically because commercial tools fail here*: meeting-copilot (macOS, "bidirectional Chinese-English live transcription + code-switching"), ownscribe fork ("Taiwanese Mandarin + English code-switching," notes WhisperX Chinese CER ~20% vs 3-8% for Chinese-optimized backends), notetaker-notebookllm ("bilingual zh/en + code-switching, no language toggling"), MeetU (实时中英互译). Developer effort is a strong proxy for unmet demand.
- Reddit r/Journalism (Aug 2025), "Multilingual alternatives to otter.ai": OP calls Otter's transcriptions "absolute garbage... wildly inaccurate" while hunting for multilingual options.
- Fireflies' own community forum (Jan 2025-2026): user Melina Mai — "I am having meetings in 2 languages and it's not efficient that I have to reprocess each meeting... It should automatically detect the spoken language." Fireflies shipped Multi-Language Mode (Beta) in direct response; it's Business/Enterprise-only.

**4. Translation demand is real but is mostly served at the *live-captions* layer, not the *meeting-record* layer.**
- Zoom now ships live translated captions (46 languages) and a Voice Translator (Jul 2026 blog: "when half the room speaks Mandarin and the other half speaks Spanish, meetings get complicated fast").
- Indie tools keep appearing (SonicMeet — built by a non-native-English engineer: "keeping up in a second language is exhausting... I was tired of missing things in fast-paced meetings"; Jamy — "search in one language, retrieve from meetings held in another").
- Gap repeatedly named by reviewers: Fireflies has "no integrated translation... a frequent limitation raised by international teams" (Cosmo Edge, Sep 2025); Otter's translation is a chat workaround; Notta charges translation as a $6-9/mo add-on. **Cross-language *search/Q&A across the archive* ("ask in English about a meeting held in Chinese") is almost entirely unclaimed territory.**

### B. Grouping Related Meetings

**5. Users explicitly complain that meeting tools are flat and context-free.**
- tl;dv's Granola review (Jun 2026): "One of the biggest limitations of Granola, for me, was the lack of organization... folders seem to be the only way to organize transcripts and notes"; and quoting a user: the AI lacks "full workspace context" — "Granola can only understand one meeting at a time."
- r/NoteTaking deep-dive of 25+ apps: "Frustrations: No folders = chaos... Wish List: Folders. Just folders."
- ClickUp feedback board (multiple threads, heavily voted): "I'd love to see all recurring meeting notes grouped together... so it's easy for my team to look back across multiple weeks without additional searching"; "I'm constantly moving documents for recurring meetings so they are all housed in one location"; recurring-meeting settings that don't persist are called out as "desperately needed."
- RevOps forums: entire playbooks exist for the structural problem that "call recordings aren't tied to opportunities" — recordings attach to contacts/chronology, not deals.

**6. Competitors are converging on grouping as *the* 2026 battleground — validating the demand.**
- Granola launched **Spaces** (Apr 2026, with Series C) — organize notes "by project, department, or topic" and query across them; plus People & Companies views. Their own marketing leans on the pain: "meeting notes often live in isolation... difficult to synthesize across time and context."
- Notion Meeting Notes auto-links recurring-event instances; Fireflies pitches cross-meeting semantic search ("who mentioned Q3 budget"); Fathom/Granola push CRM sync (HubSpot/Attio/Affinity); a cohort of new products (Note Genie "every client in one folder → knowledge base," Superdone "living project graph," notemeeting "cross-meeting context: how did they react to pricing last time?") are built entirely on this premise.
- Important nuance: grouping is being solved as **folders + chat-over-folder**, not as automatic entity-linking (deal/person/project auto-assignment). Auto-grouping by deal/person with carried-over context is still mostly unshipped — Granola's People/Companies view is the closest.

### C. Who does multilingual well, and how users respond

- **Notta** is the proof-of-concept that multilingual wins customers: 58 languages, bilingual side-by-side transcripts, CJK-optimized engine; "for global teams, Notta is the obvious choice" is the consistent reviewer verdict, and it's the default recommendation in JP/TW/CN content. But its reputation is badly damaged by billing (Trustpilot ~1.4-2.1/5, "88% one-star," dark-pattern annual trial), the free tier (3 min/recording) is ridiculed, non-CJK accuracy is mixed ("Greek results very poor," "in my language the translation is not accurate at all"), and mixed-language output is two parallel transcripts rather than one clean interleaved record.
- **tl;dv** won a 2026 Japanese-transcription bench test (CER 0.8%) and markets 30+ languages with mid-call switching; reviewers rate it the strongest Western tool for multilingual.
- **Fireflies** shipped word-level Multi-Language Mode (60+ languages, beta) — but summaries come out only in the *dominant* language, translation is absent, and re-transcription is capped at 3 attempts.
- **China-domestic tools** (飞书妙记, 通义听悟 with real-time EN→CN translation and dialect support, BibiGPT) dominate pure-Chinese use cases; the underserved segment is precisely **cross-border teams that need both languages in one system** with Western-style calendars/Zoom/Meet.

## 2. Demand Signal Strength

| Theme | Signal | Basis |
|---|---|---|
| Multilingual transcription (CJK + code-switching) | **STRONG** | Quantified accuracy gaps (78% vs 92% JA; <50-70% ZH on Otter), documented churn, DIY open-source workarounds, every JP/TW/CN review leading with the language question |
| Native translation of transcripts / cross-language search | **MODERATE→STRONG** | Live-caption translation is getting commoditized by Zoom; but post-meeting translated records, bilingual summaries, and cross-language archive Q&A are explicitly named gaps (Fireflies "no integrated translation," Notta paywalls it) |
| Grouping meetings by project/deal/person | **STRONG (and rising)** | Direct complaints ("no folders = chaos," "constantly moving documents for recurring meetings"), heavy vendor convergence (Granola Spaces, Notion, Fireflies), RevOps pain around calls-not-tied-to-deals |
| Auto-grouping / carried context across recurring & related meetings | **MODERATE** (demand is real, articulation is early) | ClickUp feedback threads, "prep me from the last 3 calls" marketing everywhere; nobody flat-out does it automatically yet |

## 3. Representative Quotes

| Quote (verbatim or close paraphrase) | Source | Date |
|---|---|---|
| "I think otter.ai's transcriptions are absolute garbage... wildly inaccurate" (seeking multilingual alternatives) | Reddit r/Journalism, "Multilingual alternatives to otter.ai" | ~Aug 2025 |
| "Otter can only transcribe in one language at a time... select the associated language before the meeting" | Otter official help center | current (May 2026) |
| "Otter的中文转写很拉胯，准确率大概只有六七成" (Otter Chinese transcription is terrible, ~60-70% accurate) | 王尘宇 blog, 2026 AI 会议记录工具实测 | Jul 2026 |
| "我团队用了半年 Granola... 中文会议摘要质量明显比英文差... 最后切到 BibiGPT" (SaaS founder churn story) | BibiGPT vs Granola comparison | Apr 2026 |
| "目前Granola电脑端还不支持转录中文" (Granola desktop still can't transcribe Chinese) | 新榜 hands-on review of Granola | ~2026 |
| Japanese accuracy on identical Zoom meetings: Notta 92% vs Otter 78%; jargon meetings 80% vs 65% | 生成AI総合研究所 benchmark | Jun 2026 |
| "I am having meetings in 2 languages and it's not efficient that I have to reprocess each meeting... It should automatically detect the spoken language" | Fireflies community forum (Melina Mai) | Jan 2025/26 |
| "Fireflies does not provide automatic translation of transcriptions... a frequent limitation raised by international teams" | Cosmo Edge, Fireflies user-review synthesis | Sep 2025 |
| "One of the biggest limitations of Granola... the lack of organization... Granola can only understand one meeting at a time" | tl;dv Granola review (20+ meetings) | Jun 2026 |
| "No folders = chaos... Wish List: Folders. Just folders." | Reddit r/NoteTaking, 25+ app deep-dive | ~2025 |
| "I'd love to see all recurring meeting notes grouped together... to look back across multiple weeks without additional searching"; "I'm constantly moving documents for recurring meetings" | ClickUp AI Notetaker feedback board (multiple voters) | 2025-2026 |
| "Meeting notes often live in isolation... difficult to synthesize across time and context" (their rationale for launching Spaces) | Granola Spaces launch coverage | Apr 2026 |
| "Code-switching is not a quirk of Hong Kong meetings — it is the default mode... most engines fail" (dashboard → 大薯波 mangling) | Oakmeeting.ai, Cantonese-English code-switching | May-Jun 2026 |
| "In a country where the main language isn't my native one... keeping up in a second language is exhausting" (founder's why-I-built-this) | SonicMeet homepage | 2026 |

## 4. Verdicts

**Multilingual / native translation — STRONG demand, weakly defended.** The pain is loudest exactly where Tape's likely users live: Chinese-English code-switched meetings, for which every Western incumbent (Otter one-language-per-meeting, Granola desktop no Chinese, Fathom generic Whisper) measurably fails, and the only credible challenger (Notta) is hobbled by billing scandals, a 3-minute free tier, and two-parallel-transcript UX instead of one clean interleaved record. The winning wedge is native handling of mixed-language speech in a single transcript plus bilingual summaries and cross-language archive search ("ask in English, retrieve from a Chinese meeting") — the last of these is essentially unclaimed. Avoid competing on live captions, which Zoom is commoditizing; compete on the permanent multilingual meeting record.

**Grouping related meetings — STRONG demand, actively contested.** Users verifiably hate flat chronological lists ("no folders = chaos," recurring-meeting notes scattered, calls not tied to deals), and the entire market — Granola Spaces, Notion recurring-note linking, Fireflies cross-meeting search — pivoted to grouping in the first half of 2026, which confirms the demand but means folders alone are no longer differentiating. The open ground is *automatic* grouping: auto-linking meetings to a deal/person/project entity, carrying context across a recurring series, and answering questions across a relationship's whole history without the user filing anything. For a VC/cross-border-team audience, "every meeting auto-attached to the deal and the person, queryable in either language" combines both findings into one positioning sentence that no incumbent currently owns.
