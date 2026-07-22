# Tape Design Guide

## Product promise

Tape turns meetings into a reliable team memory. It should help colleagues capture a meeting, find what was said, correct the record, share it, and follow up without learning how the system works.

The interface should feel like a calm editorial workspace: clear white space, strong typography, precise controls, and restrained coral accents. It is a working archive, not an analytics console.

## Core rule

Hide unnecessary information. Make the next useful action obvious. Keep every screen intuitive and clean.

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

### Typography

Use Geist for the application interface. Use Fraunces, Space Grotesk, and IBM Plex Mono only on the public site and sign in surfaces where the editorial brand voice is intentional.

Headings should be short, sentence case, and visually distinct through size and weight rather than uppercase. Small uppercase text may label a section, but it must not repeat the heading below it.

Use tabular numerals for timers, durations, and changing metrics. Keep body copy readable with generous line height and a narrow measure.

### Spacing and surfaces

Use the existing four pixel scale, with eight pixels as the common spacing step. Prefer whitespace and alignment over nested cards.

Cards should represent a meaningful group, not every section. Avoid card inside card. Keep borders quiet and shadows subtle. Use a maximum content width that supports scanning, while long transcript text should use a narrower reading measure.

### Motion

Motion should explain a state change. Use short transitions for menus, disclosure, uploads, and recording state. Respect reduced motion. Avoid decorative animation in the workspace.

## Components and patterns

### Navigation

Keep global navigation short and stable. Make the active location clear. The primary create action may use coral; other navigation items should remain quiet. Move infrequent account actions behind a compact account control when navigation becomes crowded.

Task critical flows such as recording use a focused layout for the entire route, including setup, active recording, and upload. Remove global navigation, provide a clear safe exit before recording starts, and warn before any action would discard unsaved work.

### Buttons

Use one primary button per decision area. Secondary actions use outline or ghost styles. Destructive actions stay visually quiet until the user enters the destructive flow, then require clear confirmation.

Button labels should describe the outcome: `Upload audio`, `Copy transcript`, `Record on phone`. Avoid vague labels such as `Submit`, `Continue`, or `Apply` when a more specific label fits.

### Forms

Group fields by one user decision. Put labels above inputs. Keep helper text brief and close to the relevant field. Reveal advanced controls only when requested.

Use the shared shadcn components for selects, comboboxes, menus, dialogs, and other interactive controls. Preserve free text entry when a suggestion list is helpful but not exhaustive.

Where safe, update search and simple filters directly. When an explicit action is required, name it for the result rather than the mechanism.

### Tables and lists

Meeting rows should prioritize title, time, people, and actionable state. Hide low value columns on smaller screens. Use a compact list or card layout on mobile instead of forcing a desktop table.

Do not expose every detected entity, provider detail, or repeated meeting relationship in the default row. Reveal supporting context when it helps disambiguate a meeting.

Related meeting groups start expanded when related rows exist, so users can see the meeting history without another action. Manual collapse controls should preserve the user’s place. Keep page size and rendered length small enough that the next meeting and pagination remain easy to reach.

The initial parent result set and the related rows loaded for each group must be bounded. Keep older related history behind an explicit load action so expanded groups do not hide pagination behind an unbounded archive.

### Transcript

The transcript is the primary reading surface. Audio, language, style, speaker correction, images, and analysis should support reading rather than compete with it.

Keep the player and the currently useful transcript controls close to the content. Secondary analysis and correction tools should be collapsible. Preserve a readable line length and make speaker changes easy to understand and undo.

On populated meeting pages, show available translation state, captured images, and speaker tools before transcript text. Keep detected entities visible as supporting information after the transcript. Omit each section when its corresponding data is absent.

### Meeting detail

Lead with the editable title and compact, human readable metadata. Put transcript content in the main column. Put sharing, related meetings, and other supporting actions after the primary content in mobile reading order.

For meetings without content, center the add content choice. Show only the source choices that can resolve the current state. Do not show an empty transcript viewer.

On meetings with content, keep Export and Copy secondary. Place Delete in an overflow or a dedicated destructive flow rather than beside frequent actions as a full emphasis button.

### Settings

Settings should reflect how colleagues think about the team, not the underlying services. Group by outcome, such as identity, access, meeting capture, and transcription quality. Show provider names only when they are necessary to make a decision.

Admin only information must be clearly separated from team member information. Read only users should see the current result without disabled forms or repeated permission explanations.

Omit settings sections that contain neither a current value nor an action. Keep long membership inventories behind disclosure or in a separate access surface instead of placing them between configuration tasks.

### Public and shared views

Keep public and shared pages quieter than the owner workspace, but retain enough context to build trust. Show compact Tape branding, the meeting title and date, who shared it or why the viewer has access, and an explicit read only state. Do not show owner actions or internal diagnostics.

### Dashboard

The meeting library and search are the dashboard’s primary job. A compact greeting and visible weekly stats belong at the top for full workspace users, with the archive kept reasonably close on desktop and mobile.

Summaries must lead to a clear next step. If a card says that meetings need attention, it should identify or link to those meetings. Avoid non actionable metrics whose meaning is unclear, such as an unexplained tone score.

Start with search and one useful status filter. Put search scope, sort, long meeting presets, participant presets, and saved view management behind secondary disclosure unless usage proves they belong in the default view.

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
