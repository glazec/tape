# Tape Design Guide

## Document role

This is the current interface and content contract. `PRODUCT.md` defines product scope, while dated specifications and plans under `docs/superpowers` preserve historical decisions and are not current UI requirements.

## Product promise

Tape turns meetings into a reliable team memory. It should help colleagues capture a meeting, find what was said, correct the record, share it, and follow up without learning how the system works.

The interface should feel like a calm editorial workspace: clear white space, strong typography, precise controls, and restrained coral accents. It is a working archive, not an analytics console.

Calendar sync feedback distinguishes completed recent sync from a queued scan of Google Calendar for missing meetings in the past 30 days, including events never imported. It asks the user to refresh shortly and does not claim the background check is complete.

## Core rule

Hide unnecessary information. Make the next useful action obvious. Keep every screen intuitive and clean.

The desktop permission panel uses one continuous surface. Keep audio checks collapsed and omit meters until capture permissions are ready. Permission recovery is available during setup under “Already enabled in Settings?” and beside the settings permission list. Offer restart without resetting grants before explicit per permission repair. Do not promise that repair removes a visible macOS Settings entry. Restart failures stay visible. Settings show the paired account and workspace, with no editable credentials in release builds. Meeting titles allow two lines, local capture says “Record on this Mac”, and live meters expose their percentage values to accessibility. Secondary text meets 4.5:1 contrast in both appearances.

The desktop settings control always uses a gear and toggles the settings below; starting capture collapses them. Keep summary spacing and the gear position stable; do not animate the entire panel when settings changes height. Recording start errors stay visible until retry or sign in, even when the calendar refreshes. Idle shows the current or next eligible calendar event. Record starts for that displayed event without an intervening chooser. During capture the title opens a searchable meeting selector with a new meeting action. Show the confirmed destination and keep Stop available while a destination change is pending. Recent meetings use this same selector to resume recording.

Inside the selector, explain that the entire current recording moves and earlier recordings stay unchanged. Show a date and transcript state for each meeting; label a creation date as Created when no event time exists. Unavailable rows explain their recording conflict. Focus search on opening, support arrow navigation and Return, and let Escape close the selector and restore title focus. The selected row stays readable. Put the optional new meeting title behind Create a new meeting. After Stop, retain a compact receipt with the confirmed meeting title, truthful upload status, and Open meeting. Keep unresolved receipts reachable and hide account content after sign out.

End prompts stay inside the recorder and also use actionable system notifications. Offer End recording and Keep recording without blocking the controls or stopping on silence. A prompt from an earlier capture must never affect a newer one. Distinguish capture stopped, upload pending, and transcript processing; closing capture controls does not imply upload completion.

Every visible element must help the user do one of four things:

1. Understand the current state
2. Complete the primary task
3. Find or review meeting content
4. Recover from a problem

If an element does not support one of these jobs, remove it or reveal it only when relevant.

## Users and priorities

Tape is primarily for internal colleagues with limited time. Design for fast scanning and confident action rather than feature discovery.

The main workflows, in priority order, are:

1. Find a meeting or answer in the archive
2. Review a transcript and listen to the relevant moment
3. Add a meeting through a link, recording, transcript, or phone capture
4. Correct speakers, titles, and transcript details
5. Share useful meeting content
6. Manage team defaults when necessary

Administration and implementation details must never compete with daily meeting work.

## Information hierarchy

Each screen should have one clear subject and one clear primary action.

Order content by user value:

1. Page subject and truthful state
2. Primary content or recovery action
3. Frequent supporting actions
4. Context that helps interpretation
5. Rare settings and destructive actions

Avoid repeating the same label, state, or explanation in the page heading, card heading, badge, and body copy. One strong statement is better than several weak ones.

Use progressive disclosure for filters, advanced options, metadata, exports, and destructive actions. Do not display controls whose action is unavailable. For example, hide transcript actions when no transcript exists.

Generated intelligence is supporting material, not source truth. Detected entities, emotion, talk share, summaries, and similar analysis must follow the transcript or appear behind disclosure. Show confidence or uncertainty when it changes how a colleague should interpret the result. Never let a long machine generated list delay access to the meeting itself.

Configured completion emails contain separate notes and original transcript TXT attachments. Label notes as AI generated and preserve speaker names and timestamps in the transcript. Send only to the meeting owner's login address. Email failure must not change the meeting's transcription or translation state; delivery diagnostics stay in the background job record.

The recorder’s automatic event card and missed bot alerts follow personal ownership or active calendar participation with recording rights. Admin visibility alone must not put a colleague’s event on the personal recorder. Stop and destination changes must serialize so Stop freezes the confirmed destination.

Sharing suggestions show the email and organization. An unknown complete email gets a selectable “Share with …” option. Suggestions do not change the scope of Whole organization. Dashboard errors offer Try again without signing the user out. Desktop launch and sign in handoff show the recorder window, with one action for the next setup step.

## Note moments and recording import

Keep Add timestamp beside personal notes, with `@now` plus Space and an explicit `[12:34]` available in its tooltip. Render saved moments inline once, with Edit notes available. Unresolved captures say Moment until actual recording timing resolves them. Retain capture identity through edits and conflicts; use the matching recording timeline across pauses. Timestamp activation highlights and focuses its transcript segment and respects reduced motion.

After selecting a single recording, replace the large chooser with a compact change file action. Order the review as local player and Jump to, editable recording date and timezone, then explicit destination choices. Label uncertain date sources and disclose a different embedded file time. Show loading, lookup failure with retry, and empty results separately. Existing recordings remain unavailable with an Open meeting link. The primary action names a chosen calendar destination and explains that its sharing settings apply.

## Empty, loading, and failure states

Empty space should lead to the next useful action.

When a meeting has no transcript and the user can add content, place the add content action in the center of the content area. Do not also show an empty transcript panel or a redundant no transcript message.

Recovery takes priority over sharing. When content is missing or failed, emphasize the action that creates useful meeting content and keep sharing secondary or hidden until it can produce value.

Explain failures in plain language and provide one recovery path. Show technical identifiers, provider payloads, and job details only in diagnostic surfaces intended for administrators.

Loading states should preserve the expected layout and state what is happening only when the wait is meaningful. Never make a failed backend state look complete or healthy.

## Visual direction

### Character

Quiet, editorial, trustworthy, and compact. The public site may be more expressive, but the product workspace should remain focused and calm.

### Color

Use the existing white and graphite system.

1. White is the primary canvas
2. Near black is the primary text color
3. Muted graphite is for supporting text
4. Light gray distinguishes grouped surfaces
5. Coral is reserved for the primary action, active state, focus, and small brand moments
6. Red is reserved for destructive actions and errors

Do not use coral for decoration when it would compete with the primary action. Prefer a border, tonal surface, or spacing before introducing another color.

Meeting status badges use muted slate for Scheduled, green for Ready, amber for In progress and In waiting room, and rose for Recording. Only a bot that is actually recording shows Recording; a bot that is joining or held in the host's waiting room never does. Apply the same colors to library rows and meeting details, retaining text labels and readable contrast in both themes.

The brand coral is `#EC4F44`. It drives the shadcn `--primary`, `--ring`, and `--sidebar-primary` tokens plus `--chart-1`, so application buttons, focus rings, sidebar accents, and default charts all follow the brand.

Every neutral in `app/globals.css` is declared in OKLCH and carries a trace of the brand hue (hue 30, chroma 0.002 to 0.024). Nothing is a pure gray and nothing is `#fff` or `#000`, on either surface. The public site uses the landing tokens: `--paper` warm near white canvas, `--mist` warm light surface, `--ink` warm near black, `--graphite` supporting text, `--ash` quiet metadata, `--brand` coral for fills, and `--brand-ink` for coral text.

Two contrast rules follow from those tokens:

1. `--brand` coral reaches only 3.6:1 on paper, so it is a fill color. Small coral text uses `--brand-ink`, which passes AA.
2. `--ash` is the quietest text color that still passes AA on paper. Anything quieter than `--ash` is decoration, not text. Supporting body copy uses `--graphite`.

### Public landing page

The landing page (`app/page.tsx`, `components/landing/*`) is the expressive brand surface, in the same calm editorial register as Granola-tier product sites: warm paper canvas, generous whitespace, Fraunces serif headlines with a coral italic accent word, Space Grotesk body, and IBM Plex Mono uppercase microcopy. No brutalist borders, hard shadows, metric grids, or dashboard screenshots inside the hero.

The page is built as one cassette. The slogan is **It’s all on Tape.**, with a line directly under it that states the thesis and the category (conversation is where the best thinking happens; Tape records every call and every room, in Chinese and English, and turns it into what happens next). The page argues one thesis, that conversation is the richest record a team makes, and then serves four kinds of team: bilingual, AI-native, privacy-first, and engineering. Sections are numbered like tracks: Side A carries the product (A1 After the call, A2 Languages, A3 In the room, A4 Agents) and Side B carries ownership and buying (B1 Open source, B2 Pricing, B3 Liner notes for the FAQ, B4 Press record for the closing call to action). Every section opens with a `TrackLabel`.

Shared primitives live in `components/landing/landing-section.tsx`: `Container` sets the single site measure and gutters, `TrackLabel` renders the coral track pill and label, `ArtPanel` is a rounded painted plate with an HTML product window floating on it, and `TrackSection` is the stacked shape (label and heading left, lede right, full-width panel, three points). Sections must use these rather than repeating grid and measure classes, so every section edge lines up.

Art panels are fal generated gouache and risograph plates in one series: warm paper ground, coral tape accents, sage, ochre, and ink. They live in `public/media/art/` as webp. New plates must match that series; a digital or cold palette breaks it. The art carries mood and the window on top carries the claim, so a panel never appears without a mockup except the hero and the trust band.

The hero is a painted coral tape ribbon on paper, animated into a seamless 16 second loop (`public/media/hero-loop.mp4`, an 8 second clip played forward then reversed) with `hero-loop-poster.webp` as its poster. From `lg` up it runs full-bleed behind the copy with a paper gradient on the left; below `lg` it sits under the copy as its own plate. It pauses under reduced motion. There is no WebGL on the page. The H1 uses the `text-display-hero` token and stays on one line at 1440px.

Transcription is no longer a differentiator, and neither is bot-free capture on its own. The section order follows the thesis, then each audience's track:

1. Thesis band, warm walnut: “Your team says more in one call than it writes all week.” with four audience cards that link to the track written for each team. It stands in for a customer logo wall until real logos exist; never fabricate logos or quotes
2. `A1 · After the call` (AI-native teams) — the follow-up mockup with its four real parts (To do, Dynamic, Potential connections, Potential research), a four column explainer, the connections figure, and the auto research card marked as next, never as shipped
3. `A2 · Languages` (bilingual teams) — the one full-bleed band: the bilingual transcript on the braided ribbon plate, with a single line of support
4. `A3 · In the room` (privacy-first teams) — the local macOS recorder first, calendar bots for Zoom and Meet second, as two panels side by side
5. `A4 · Agents` — split layout with a numbered list; the whole meeting database queryable over MCP by the assistant the team already uses, read only and scoped to the caller's access
6. `B1 · Open source` (engineering teams) — the only ink section, headed “Don’t like how it works? Fork it.”: a terminal window with the real first run from the README beside a card of the two reasons the code is public (make it yours, own your data), with the license and live GitHub activity above the fork button
7. `B2 Pricing`, `B3 Liner notes`, `B4 Press record`, then the footer with the giant cropped `tape.` wordmark

Section grammar alternates on purpose: centered showcase, full-bleed band, stacked track, split, dark grid. Do not add another stacked `TrackSection` in a row. Partner logos live in `public/brand/partners/` as monochrome graphite SVGs.

The launch film (`public/media/tape-launch-v6.mp4`, 30 seconds: thesis, bilingual line, connections and to-dos, ask your own AI, fork it, slogan) is generated from `scripts/launch-film/film.html`, a deterministic timeline rendered frame by frame by `scripts/launch-film/render.mjs` and muxed with a fal generated music bed. Edit the HTML and re-render rather than editing video.

The windows in the follow-up, capture, languages, and agents panels are interface mockups drawn in HTML (`components/landing/mockups.tsx`), not screenshots. Prefer that for anything the page needs to *argue*: a 1440px application capture scaled into a 640px column is unreadable, and raster captures drift out of brand as the product changes. Each mockup shows one idea, uses the live brand tokens, and stays crisp at any size. Keep the content generic: no real customer names and no quotes attributed to real people.

Use `ProductLogo` with `variant="light"` on dark backgrounds. Never apply a CSS `invert` filter to the logo.

### Typography

Use Geist for the application interface. Use Fraunces, Space Grotesk, and IBM Plex Mono only on the public site, sign in, and not-found surfaces where the editorial brand voice is intentional. Inside the workspace, IBM Plex Mono appears only through `AppLabel` (below).

The public site has one display scale, defined as font-size tokens in `app/globals.css`: `text-display-hero` for the hero H1, `text-display-1` for large section headings, `text-display-2` for section headings, `text-display-3` for sub-display lines, `text-lede` for opening paragraphs, and `text-label` for mono microcopy. Each step is fluid through `clamp()` and monotonic, so a heading never shrinks as the viewport grows. Never hand-write a landing font size; add a token if a step is missing.

Those custom sizes are registered with tailwind-merge in `lib/utils.ts`. Without that registration `cn()` reads `text-display-2` as a text color and silently drops it whenever a real color follows.

The application uses a fixed rem scale with a tight ratio: `text-2xl` for a page heading, `text-lg` for a card heading, `text-sm` and `text-xs` for supporting rows. Do not use fluid `clamp()` sizes or display serif faces inside the workspace.

Headings should be short, sentence case, and visually distinct through size and weight rather than uppercase. Small uppercase text may label a section, but it must not repeat the heading below it. Mono microcopy is never smaller than 11px.

The one exception to Geist inside the workspace is `AppLabel` (`components/app-label.tsx`): IBM Plex Mono, `text-label` (11px), uppercase, `tracking-[0.2em]`, muted. It is the shared brand cue for small section labels: meeting list day headings, follow-up subheads, and transcript Speakers and Mentioned labels. Use the component, or `appLabelClassName` where an element already exists, rather than hand-writing uppercase label classes. Step numbers in the setup card use the same mono face.

Use tabular numerals for timers, durations, and changing metrics. Keep body copy readable with generous line height and a narrow measure: cap prose around 48ch to 52ch, and use `text-pretty` on body copy and `text-balance` on display headings so lines do not end in orphans.

### Spacing and surfaces

Use the existing four pixel scale, with eight pixels as the common spacing step. Prefer whitespace and alignment over nested cards.

Cards should represent a meaningful group, not every section. Avoid card inside card. When a group needs a surface, use one tonal plate (`rounded-2xl bg-muted`, no ring or border) and put tonal tiles (`bg-background`) inside it rather than more bordered boxes. Keep borders quiet and shadows subtle. Use a maximum content width that supports scanning, while long transcript text should use a narrower reading measure.

Do not separate page sections or list items with rules. No horizontal dividers between sections, no `divide-y` between list rows, and no vertical side rails to group items. Granola and Otter separate sections with heading size and whitespace alone, and so do we: a group is a `text-base font-semibold` heading with about 40 to 48 px before the next one, subsections are small uppercase muted labels with 32 px between them, and items within a subsection sit 16 px apart. Group items by placing them under a label, not by drawing a line. A tonal hover surface is fine for an interactive row; a resting border is not. Rules remain acceptable only where they mark a physical edge, such as a fixed player bar or a dialog footer.

The meeting page follows Granola's Enhanced and Transcript switch: a rounded segmented control under the title chooses Notes (sparkle icon) or Transcript (audio icon), and `?view=transcript` opens the second. Both views stay mounted; the hidden transcript keeps its fixed player bar visible, and any source link, connection name or note timestamp that points into the transcript switches to it before scrolling. Notes holds two groups, My notes (private, with Add timestamp and save status on the right) and From the transcript (the generated To do list, Dynamic, Potential research and Potential connections, with Regenerate on the right). Do not reintroduce a separate AI followup section. Transcript holds Speakers, Mentioned and the lines; its own heading stays for screen readers only because the tab names it. Meetings that have no transcript yet keep the plain stacked layout without the switch. Every generated item ends in one muted meta line of the same form: an optional lead in such as the timing or relationship, a dot, then Source and its timestamps.

The public site paces sections rather than repeating one padding value: the thesis band is tight, content sections use the standard step, the dark open source section is more generous, and the closing call to action is the most generous of all. Split sections align their columns to the top. Centering columns of unequal height leaves matching voids above and below and reads as a mistake.

Any grid whose children can hold long unbreakable content needs `[&>*]:min-w-0`. A grid item keeps a content-based minimum width otherwise, and it will push past its track and scroll the page sideways on small viewports.

### Motion

Motion should explain a state change. Use short transitions for menus, disclosure, uploads, and recording state. Respect reduced motion. Avoid decorative animation in the workspace.

## Components and patterns

### Navigation

Keep global navigation short and stable. Make the active location clear. The primary create action may use coral; other navigation items should remain quiet. Account actions, including Setup guide and Sign out, live behind the compact account control at the end of the header.

Task critical flows such as recording use a focused layout for the entire route, including setup, active recording, and upload. Remove global navigation, provide a clear safe exit before recording starts, and warn before any action would discard unsaved work.

### Buttons

Every button is a pill (`rounded-full`), matching the landing page. Each screen has one primary action:

- **Coral (`variant="brand"`)** is reserved for the single create action, the header New meeting split button. Nothing else in the workspace is a coral fill, so it never competes with an in-page primary.
- **Ink (`variant="ink"`, also the `default`)** is the in-page primary: `bg-ink text-paper`, hovering to graphite. Examples are Add meeting bot, Copy MCP server link, and the upload submit in Add meeting content. Use at most one ink pill per decision area.
- Secondary actions use `outline` or `ghost`. A group of parallel steps, such as the setup card, gives every step the same secondary style instead of mixing outline, ghost, and fills.

Destructive actions stay visually quiet until the user enters the destructive flow, then require clear confirmation.

Button labels should describe the outcome: `Upload audio`, `Copy transcript`, `Record on phone`. Avoid vague labels such as `Submit`, `Continue`, or `Apply` when a more specific label fits.

### Forms

After successfully adding a meeting link, open the returned meeting's detail page so the user can write notes while the bot joins or waits for its scheduled start. Apply this after bot selection and nearby meeting confirmation as well.

Group fields by one user decision. Put labels above inputs. Keep helper text brief and close to the relevant field. Reveal advanced controls only when requested.

Use the shared shadcn components for selects, comboboxes, menus, dialogs, and other interactive controls. Preserve free text entry when a suggestion list is helpful but not exhaustive.

Where safe, update search and simple filters directly. When an explicit action is required, name it for the result rather than the mechanism.

### Tables and lists

Meeting rows should prioritize title, time, people, and actionable state. Hide low value columns on smaller screens. Use a compact list or card layout on mobile instead of forcing a desktop table.

Do not expose every detected entity, provider detail, or repeated meeting relationship in the default row. Reveal supporting context when it helps disambiguate a meeting.

Related meeting groups start collapsed, so the library reads as one timeline; the parent row shows how many related meetings it holds. Expanding a group shows at most four meetings, including the parent, and only related meetings from the past two months. A Show more control on the parent row reveals up to four additional meetings in that group, including older history once recent meetings are exhausted.

When the library is ordered by time, upcoming meetings sit under one Upcoming heading and past meetings under one heading per local day, and the Started column shows only the time. Day boundaries follow the viewer's timezone, so the headings render in the browser. Search applies as the person types and filters apply when picked; there is no separate Search button. Manual collapse controls should preserve the user’s place. Keep page size and rendered length small enough that the next meeting and pagination remain easy to reach.

Automatic groups require the same set of external organizations from attendee email domains. A conversation with A stays separate from an introduction involving A and B, even if the title or an attendee overlaps. Personal email addresses identify individual participants. Meetings without attendee evidence may match each other by title, but must not bridge groups with known participants.

The initial parent result set and the related rows loaded for each group must be bounded. Keep older related history behind an explicit load action so expanded groups do not hide pagination behind an unbounded archive.

### Transcript

The transcript is the primary reading surface. Audio, language, style, speaker correction, images, and analysis should support reading rather than compete with it.

Keep the player and the currently useful transcript controls close to the content. Secondary analysis and correction tools should be collapsible. Preserve a readable line length and make speaker changes easy to understand and undo.

On populated meeting pages, show available translation state, captured images, and speaker tools before transcript text. The transcript header stacks Speakers (each with its share of the conversation as a visible percentage) and Mentioned (organizations, money amounts and names as a label and value grid), the way Otter shows Speakers and Keywords. Combined meetings keep Mentioned after the transcripts. Omit each section when its corresponding data is absent.

### Meeting detail

Place My notes above the transcript or recovery panel in every meeting state. Align the title and writing text on one edge, keep privacy in a lock icon with an accessible Only visible to you label, and reserve a stable space for quiet autosave feedback. Use 16 px writing text, a subtle outer focus ring, and automatic height with a viewport aware cap so long notes do not hide the transcript. Keep a static loading placeholder until notes are available. Preserve drafts through meeting refreshes and keep failed saves visible with Retry. For conflicting edits, offer Copy my edits and require confirmation in the shared dialog before loading the saved version. Show the character limit only when notes approach it. Keep Markdown writing and formatted Preview behind one quiet toggle. Omit general formatting and question instructions beneath the editor. Preserve timestamp navigation in Preview. Tables scroll inside the note at narrow widths; pasted tables retain row and column structure.

Question answers belong directly beneath their questions, marked From transcript with a quiet left rule and expandable sources. Put an icon-only Regenerate answer control immediately beside the source label. Render the answer as a directly editable, borderless textarea with automatic saving, an accessible label, and a visible focus treatment; do not require Edit, Done, or Cancel buttons. Preserve deliberately cleared answers. Preserve earlier pairs when writing continues. Use a 1.2 second pause after a question mark, respect IME composition, and never move focus when an answer arrives. Keep the previous answer visible during regeneration. Show changed question or transcript state explicitly; protect edited answers with confirmation before regeneration. Answer edits use the existing notes save status and draft recovery. Keep the answer read only while regeneration is running so incoming results cannot overwrite typing. Bound the notes document height so the transcript remains reachable. Source links and answer actions have at least 44 px touch targets.

Lead with the editable title and compact, human readable metadata, with Share, Export, Copy, and the overflow menu on the title row. The page is one centered reading column. Private notes and the AI followup come before the transcript, because they are the summary layer; the transcript follows. The AI followup generates on its own when a transcript finishes, so the page opens on it; Regenerate stays available, and Generate appears only when automatic generation has not produced one. Related meetings sit behind a compact chip under the metadata rather than in a side column, and sharing opens in a dialog from the Share button.

Show available participant names below the meeting metadata, including scheduled meetings without a recording or transcript. Omit the participant row when no names or emails are available to the viewer.

Empty lists and empty results use `EmptyState` (`components/empty-state.tsx`): an optional `AppLabel`, one plain sentence, an optional supporting line, and at most one action, an ink pill when there is a useful next step.

Not-found pages (`app/not-found.tsx`, and `app/meetings/[meetingId]/not-found.tsx` for meetings in another workspace) sit outside the workspace shell, so they follow the sign-in page's landing language through `BrandedNotFound`: logo, mono eyebrow, a Fraunces line, a plain explanation, and an ink pill back to Meetings.

For meetings without content, center the add content choice. Show only the source choices that can resolve the current state. Do not show an empty transcript viewer.

The add content panel accepts audio and transcript files through either a file picker or drag and drop. Show the selected files, preserve audio order, and accept only one transcript file at a time. Disable file changes while uploading.

Completed meetings expose Replace audio in the same overflow menu as Delete meeting for users who can manage the meeting. The replacement dialog accepts the corrected audio and explains that it generates a new transcript while preserving the meeting identity. Upload controls and dialog dismissal are locked during upload.

On meetings with content, keep Export and Copy secondary. Place Delete in an overflow or a dedicated destructive flow rather than beside frequent actions as a full emphasis button.

For single recording playback, waveform height reflects measured audio amplitude, including meetings longer than 45 minutes. Quiet passages and silence stay close to the baseline; short sound peaks remain visible. The browser receives compact audio levels from the authenticated audio route. Transcript activity is a fallback while levels load or are unavailable, and for combined recordings. Preserve playback and seeking when waveform generation fails.

### Settings

Settings should reflect how colleagues think about the team, not the underlying services. Settings is one page with a sticky side rail of its sections (Connected accounts, Workspace, Meeting bot, Vocabulary, Members, Billing) and an organization picker above it when there are several. Fields save on their own, with one Saved indicator by the page title and no Save buttons. Each field is a label column and a control column of the same widths in every section. Sharing group members are removable chips; vocabulary is a Term and Hint table where Enter adds a row and × removes one. Group by outcome, such as identity, access, meeting capture, and transcription quality. Show provider names only when they are necessary to make a decision.

Admin only information must be clearly separated from team member information. Read only users should see the current result without disabled forms or repeated permission explanations.

Omit settings sections that contain neither a current value nor an action. Keep long membership inventories behind disclosure or in a separate access surface instead of placing them between configuration tasks.

### Public and shared views

Keep public and shared pages quieter than the owner workspace, but retain enough context to build trust. Show compact Tape branding, the meeting title and date, who shared it or why the viewer has access, and an explicit read only state. Do not show owner actions or internal diagnostics.

### Dashboard

The meeting library and search are the dashboard's primary job. Full workspace users also see the page title, one sentence of this week's activity, and a one line calendar status with its sync action. Shared only users go directly to the transcripts granted to them.

Scheduled meetings appear only within the next 48 hours. Apply this cutoff before grouping and pagination so distant invitations do not push recent meetings down the dashboard.

Timed invitations with at least two distinct participant emails remain visible without a meeting link or location. Offer local recording for upcoming meetings and recording recovery for past missed meetings.

Activity summaries must use understandable measures and a declared time range. Operational warnings must lead to the affected meetings or a direct repair action. Avoid ambiguous scores and healthy looking status when capture or transcription failed.

Keep search, status, scope, and sort easy to scan. Saved view management and older history controls stay secondary. Preserve the active filters and related meeting history when the user paginates or opens a related group.

### Billing and credits

Keep billing inside Team settings instead of primary navigation. The Team settings card shows remaining workspace credit, current month workspace consumption, current month personal consumption, and a clear link to billing details.

The detail page supports current month, previous month, trailing 90 day, and all time consumption. Show personal and organization provider costs as compact USD totals. Organization detail is aggregate only. Recent activity shows only meetings owned by the signed in user.

Label exact provider reported charges separately from published rate estimates. Keep pricing sources and assumptions behind disclosure. Clearly identify historical estimates and explain unavailable cost history.

For limited personal workspaces, lead with credit remaining, the original allowance, and a clear exhausted state. Explain that existing meetings remain available when new provider work is paused. Internal workspaces with no configured limit should say “No limit” rather than inventing a balance.

## Responsive behavior

Design mobile order in the document structure, not only through visual CSS placement.

At small widths:

1. Preserve the page title and primary action above secondary controls
2. Replace dense tables with stacked meeting summaries
3. Collapse advanced filters and metadata
4. Keep touch targets at least 44 pixels
5. Avoid horizontal scrolling for core workflows
6. Keep recording controls reachable with one hand and make active recording unmistakable

## Accessibility

Use semantic headings, landmarks, labels, and native controls. Every interactive element needs a clear accessible name and visible focus state. Color must not be the only state signal.

Maintain at least WCAG AA contrast for text and controls. Announce asynchronous success, failure, upload, transcription, and recording state changes. Menus and disclosure controls must expose expanded state and control relationships.

## Content voice

Write like a helpful colleague. Be direct, calm, and specific.

1. Prefer `Upload an audio file` to `Ingest media source`
2. Prefer `The meeting bot did not join` to `Provider capture failure`
3. Prefer `Try uploading the recording` to a passive error description
4. Avoid explaining what is already visually obvious
5. Keep technical vendor names out of everyday copy unless the user must choose or troubleshoot that vendor
6. Make action labels match the result exactly. If the system may schedule or immediately join, explain that choice before action rather than combining outcomes into an ambiguous label
7. Verify every product claim and call to action against the destination and the capability that exists today

## AI followup

Show the generated followup in the Notes view under From the transcript, below My notes. To do list and Dynamic are stacked plain lists with at most two short entries each. Begin those entries with explicit @Name labels and preserve named team ownership. Add Potential research below them only when research items exist, with at most five concise question and evidence paragraphs. Each question starts on its own semibold line, followed by muted evidence text, with a small copy icon inline after the question. Align questions and source rows with the section heading, and constrain the copy surface to the reading measure with a small outward hover gutter. Each entire paragraph is a keyboard accessible copy button with a quiet copy icon and visible focus ring. Expose the evidence request as the button’s accessible description. The copy button tooltip explains that it includes the question and meeting context; omit a separate helper paragraph. Keep detailed context in the clipboard prompt and source excerpts behind timestamp controls. Do not assign research owners or deadlines unless explicitly agreed.

Show Potential connections after research when supported leads exist. Group entries under the current speaker name. Each compact entry shows the known name, company and title, a plain relationship label, brief context and existing timestamp source controls. Use Unnamed person, Unnamed team or Unnamed project when no name was said; omit absent company and title metadata. Names and organizations link to the cited transcript rather than guessed external profiles. Show three entries per speaker initially and disclose the remainder with Show more connections. Keep distinct unnamed teams separate. A saved speaker correction updates only entries anchored to affected segments; failed saves retain the previous labels. Saved connections remain readable after a rename even when the other summary sections need regeneration.

Order identified current organization speakers last, keeping other group order stable. Show Mutual connection beside the relationship when marked. Managers get one quiet Edit connection pencil per entry. Its dialog provides Mentioned by, Name, Company, Title, Type, Relationship, Description and a Mutual connection checkbox. Save changes is the primary action; Cancel discards only the draft. Retain drafts and show a specific error on save failure or conflict. Load latest version shows the saved details beside the unchanged draft before the user saves again. Cancel applies any server snapshot deferred during editing; a successful save refreshes the page data. The editor scrolls within the viewport on small screens. Changing Mentioned by moves this connection without changing transcript attribution or its evidence. Readers see no editing controls.

Keep source controls outside the copy button. Hover, tap, or keyboard activation opens the exact transcript quote and a View in transcript link; Escape dismisses the bubble. Source controls and research paragraphs have at least 44 pixel touch targets. Keep the copy status live region mounted before interaction, with atomic announcements. Show a temporary status toast only after the clipboard write succeeds; failure shows an error toast and allows another click. Support copying for existing readers as well as managers. Preserve the stacked layout and wrap long text on mobile.

Generate the followup automatically when a transcript finishes, and from the meeting page when none exists yet; show a quiet writing status rather than a Generate button while that happens. Place a quiet Regenerate icon in the AI followup heading row, aligned right, with an accessible name. Managers can generate or regenerate; readers see saved results without generation controls. Existing summaries remain visible without a research section until regenerated. Hide unavailable or source stale results. Announce generation and errors, offer Retry, and avoid exposing model details.

## Design decision process

Before finalizing any UI change:

1. State the user task and the single primary action
2. List every visible element and remove anything that does not support the task
3. Check empty, loading, success, failure, shared, and read only states
4. Check desktop and mobile content order
5. Ask a design subagent to review the change against this guide and the rule to hide unnecessary information and make the interface intuitive and clean
6. Iterate on material findings before shipping
7. Verify the live interface with real content, not only component tests

The design review should identify concrete issues with route, state, evidence, user impact, and the simplest correction. It should not reward novelty or add features without a demonstrated user need.

## Release checklist

1. The screen has one obvious purpose
2. The primary action is visible without competing actions
3. Repeated copy and unavailable controls are removed
4. Status is truthful and recovery is actionable
5. Daily workflows do not expose implementation details
6. Mobile order matches task priority
7. Keyboard navigation, focus, labels, contrast, and live status are verified
8. A design subagent reviewed the final state against this guide
9. Product claims, UI labels, and affected documentation match the shipped behavior

Team settings lists each connected Google email with its own sync and disconnect actions. Keep organization selection separate from the bot profile domain selector. Each organization domain has its own bot name and avatar; label the preferred bot setting “Use this bot when both organizations are invited.”

## Organization choices

Show the compact organization control only for users with multiple workspaces. For a new meeting link, ask “Which bot should join?” only when there are multiple bot identities, even if they share a company workspace. Show the bot name and organization domain together, with a Cancel action. Preserve that choice through nearby meeting confirmation and retries. Keep calendar account controls beside the account email. Hide selectors when there is only one choice.

## Meeting continuity controls

Show Continue recording near the notes and transcript when a supported capture has ended. Its dialog contains one meeting link field and a Join and continue action. The trigger disappears one hour after the actual recording ends; an already open dialog keeps an expiry explanation. Do not expose bot naming controls here or in the new meeting flow. Organization settings own that identity.

Keep Merge meetings in the overflow menu. Use a searchable list with title, date, and processing state, then a compact confirmation with Undo. Show recent meetings first and future meetings afterward; use the creation date when a recording has no start time. Pending transcripts remain eligible. Combined pages show chronological parts, original source links, and independent audio and transcript states. Private notes remain attached to the current page. Explain the scope of sharing beside the sharing control.

Speaker correction preserves the selected participant email and offers Remember this name only for an identified person and an all matching lines edit. Keep this option separate from the primary correction and never infer identity from a first name alone.

## Unresolved meeting visibility

A started meeting must not disappear because its status notification is missing. Keep started scheduled meetings, recordings, processing meetings, and failures as visible rows rather than folding them under a later recurring meeting. The three meeting cap applies only to future bot meetings.

Web and desktop sign in use the existing Google flow. Desktop device credentials have a separate fixed 180 day lifetime and retain their existing reconnect flow. Sessions last 180 days from login and persist across deployments. Expired sessions return to sign in with the requested destination; transient dashboard failures retain the session and offer retry.

Share dialogs list participants and recipients separately from inherent workspace administrator access. An empty recipient list must not imply owner-only visibility.

## Intel search

Show the search box before loading starting points. While matching, show verified batch progress when known. Closing the browser leaves the search running; reopening Intel restores its status or result.

Keep search history alone in the left sidebar. Separate the sidebar and list items with whitespace instead of divider lines; retain the search field outline and active tab indicator. The main surface starts with one search bar and Intel and People tabs beneath it. Intel defaults to importance, with newest first available. Use the existing warm light canvas, graphite text and restrained coral search action. Avoid score dashboards and invented interest percentages.

A selected intel item or pasted content finds interested people. Selecting a person finds relevant intel and connections. Results support continued selection. Confirm ambiguous identities using meeting title, date and a source link; do not merge equal names silently. Distinguish direct participants from contacts mentioned in meetings. Preserve source dates and show evidence on expansion. Display unsuccessful extraction as a recoverable error with paste content available, never a successful URL match with missing content. History is collapsible on mobile.

When native fallback needs a capture source, use the system window picker restricted to one window. Explain that the meeting tab must stay visible. Cancellation must not silently start audio capture. Screenshot interruption warnings stay visible while audio continues, and clear only after screenshot capture recovers. Do not imply that selecting a browser window pins a hidden tab.
