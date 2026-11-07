# Person pages, merging and AI profiles

Status: implemented on branch `feature/people-pages` (2026-11-07). Builds on the workspace person identity from 2026-11-06 (`workspace_people`, `person_emails`, `meeting_speakers.person_id`).

## User workflows

1. Open a person from a meeting. In the transcript Speakers list and the participant line under the title, a linked speaker or a participant with a known email is a link to `/people/[personId]`. An unlinked speaker or participant opens the same way for anyone who can edit the meeting's speakers: Tape creates the workspace person on first open (name from the speaker label, email only when the meeting confirms it) and links that speaker group. Readers without edit rights see plain text for unlinked people.
2. Understand the relationship. The page leads with name, emails, and one line of relationship facts (meetings together, first and last met, cadence). Then:
   - Profile (AI): background, current role, expertise across technical, operational, business and social skills, achievements, recent focus. Every line cites the meeting it came from.
   - Activity: a 12 month strip of meetings, and which colleagues meet this person.
   - To do: commitments this person made, from each meeting's followup.
   - Dynamic: what this person offers and needs.
   - Connections: people, teams and projects this person mentioned.
   - Meetings: every meeting the viewer can open where this person spoke or was invited, newest first, with their talk share.
3. Merge duplicates. "Merge duplicate" opens a dialog that ranks likely duplicates first (same name, same first name, same email name). The current person is kept; the viewer can choose which name to keep. Merging moves emails, meeting speaker links and remembered names, and redirects the old page.
4. Future attribution. After a merge, every name and email of the merged person is remembered. When a new transcript arrives, a speaker whose label is one of those names or emails (or whose meeting participant entry has one of those emails) is linked to the person automatically. Ambiguous names (remembered for two people) never link.

## Decisions

- Profiles are generated only when the page is opened and nothing is stored yet, then never automatically. Refresh regenerates. Inputs: the first meeting with the person plus every meeting in the last 90 days, limited to meetings the viewer can read. Profiles are stored per viewer, because different colleagues can read different meetings and a shared profile would leak content.
- Profile claims are grounded: each item cites segment ids that must exist in the supplied transcripts; unsupported items are dropped. The profile is labelled AI generated and dated, with its source meetings.
- Followup items are attributed by identity, not by name: a to do or dynamic belongs to the person when a cited segment is spoken by one of the person's speaker groups and the item's subject matches that speaker's name; a connection belongs when its speaker segment is theirs.
- Opening a profile for an unlinked speaker and merging people do not bump the meeting attribution revision. Who said what does not change, only which workspace person the speaker is, so existing followups stay valid. Automatic attribution only applies to speaker groups created after the name or email is remembered.
- Writes go through `SECURITY DEFINER` functions, matching the existing identity tables, which are read only to the application role.

## Data

Migration `0071_person_pages.sql`:

- `workspace_people.merged_into_id` for redirects.
- `person_names(team_id, name_key, name, person_id)` unique per team and key; remembered names used for attribution.
- `person_profiles(person_id, user_id, profile jsonb, source_meeting_ids, generated_at)` unique per person and viewer, readable and writable only by that viewer.
- `person_merges` audit rows.
- Functions `app_private.merge_people`, `app_private.open_speaker_person`, `app_private.open_participant_person`, and a `meeting_speakers` insert trigger for automatic attribution.

## Revision 2026-11-07 (user direction)

- The page is shared team knowledge: it uses every workspace meeting with the person, not only those the viewer can open. Unopenable meetings show with a lock and no link; transcripts stay closed. External guests see nothing.
- One shared AI profile per person, sourced from all team meetings, refreshed by anyone. No profile for workspace colleagues.
- To-dos have team-wide status: To do, In progress, Done (struck through), each change tagged with who and when (`followup_todo_states`, `app_private.set_todo_status`).
- The activity strip became stat tiles (meetings, time together, last met, next), a time-per-month bar chart with hover, and a "Who meets them" ranking by meetings and time.
