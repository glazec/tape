import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle>Transcript</CardTitle>
        <CardDescription>
          Speaker separated transcript with source timestamps.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y">
          {segments.map((segment) => (
            <li
              key={segment.id}
              className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[7rem_1fr]"
            >
              <div>
                <p className="text-xs font-medium text-primary">
                  {formatTimestamp(segment.startMs)}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {segment.speaker ?? "Unknown speaker"}
                </p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {segment.text}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
