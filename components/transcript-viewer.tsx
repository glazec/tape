export type TranscriptSegment = {
  id: string;
  speaker: string | null;
  startMs: number;
  text: string;
};

type TranscriptViewerProps = {
  segments: TranscriptSegment[];
};

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TranscriptViewer({ segments }: TranscriptViewerProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-lg font-semibold">Transcript</h2>
      </div>
      <ol className="divide-y divide-[var(--border)]">
        {segments.map((segment) => (
          <li
            key={segment.id}
            className="grid gap-3 px-5 py-4 sm:grid-cols-[7rem_1fr]"
          >
            <div>
              <p className="text-xs font-medium text-[var(--primary)]">
                {formatTimestamp(segment.startMs)}
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--text)]">
                {segment.speaker ?? "Unknown speaker"}
              </p>
            </div>
            <p className="text-sm leading-6 text-[var(--muted)]">
              {segment.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
