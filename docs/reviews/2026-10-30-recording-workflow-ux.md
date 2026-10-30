# Recording workflow UX review

GPT 6 Astra independently reviewed event selection and resuming recent meetings, then reviewed the corrections. The review used the SwiftUI implementation, API behavior, and rendered native windows. The original heuristic assessment was 24/40, provisional. The final review found no remaining concrete blocker within these two workflows. This is source and screenshot approval, not demonstrated parity with another product.

The normal action remains unchanged: Record starts for the displayed current or next event. During recording, the title selects its destination. Selecting a recent meeting adds the entire current recording to that record while preserving earlier recordings.

| Initial issue | Correction |
| --- | --- |
| A meeting already being recorded led to a failed start without a useful escape | Known bot capture offers Record a separate meeting. Unavailable picker rows explain why. Definite rejection preserves the confirmed destination. |
| Selection did not explain what happened to previously captured audio | The open selector states that the entire current recording moves and earlier recordings stay unchanged. |
| Repeated and manual meeting titles lacked identifying context | Every available date and transcript state is shown. Creation dates are explicitly labelled. |
| Stop removed the destination before upload finished | Receipts retain the confirmed meeting, status, and Open meeting link. Pending and failed receipts remain reachable before completed receipts. Late confirmation cannot downgrade Uploaded to Uploading. |
| Keyboard behavior was implicit | Search receives focus. Arrows navigate rows, Return selects, Escape closes, and focus returns to the title. Selection has an accessibility label and announcement. |

The second review caught receipt account boundaries, hidden older uploads, and hidden destination confirmation failures. These were corrected before approval. Sign out, expired authentication, and pairing callbacks clear display state. Stale authenticated responses cannot restore another session's meeting metadata. Durable capture recovery is retained.

The current recording row remains readable and selecting it dismisses the picker without making another destination request. The new meeting name is optional and appears behind a disclosure.

The comparison used current official documentation found through Exa. [Granola transcription](https://docs.granola.ai/help-center/taking-notes/transcription) supports resuming an ended note and appending new transcription. Its [calendar guide](https://docs.granola.ai/help-center/getting-started/syncing-your-calendars) provides an explicit event context. [Otter desktop](https://help.otter.ai/hc/en-us/articles/35973988280215-Otter-Desktop-App-Mac-Windows) provides recording controls and a floating indicator. [Otter recording guidance](https://help.otter.ai/hc/en-us/articles/40917035359255-Otter-Recording-Best-Practices-Pause-Resume-and-Upload) distinguishes stopping from uploading and limits resuming finalized recordings. The benchmark is clear state and efficient recovery, not identical functionality.

Remaining validation: measure Record click to first audio under normal and slow connections; exercise the keyboard flow and VoiceOver on the installed app; verify a real call through final upload and transcript. No live call, installation, or deployment was performed for this review.
