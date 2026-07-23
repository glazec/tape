"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";

import type { MeetingRecordingPart } from "@/lib/meeting-queries";
import { Button } from "@/components/ui/button";

export function MeetingRecordingParts({
  children,
  parts,
}: {
  children: ReactNode;
  parts: MeetingRecordingPart[];
}) {
  const [activePartId, setActivePartId] = useState(parts[0]?.id ?? "");
  const partContent = Children.toArray(children);

  if (parts.length < 2) {
    return null;
  }

  const activePart = parts.find((part) => part.id === activePartId) ?? parts[0];

  return (
    <section aria-labelledby="recording-parts-title">
      <div className="mb-5 rounded-lg border bg-background p-4">
        <div>
          <h2 className="text-sm font-semibold" id="recording-parts-title">
            Recording continued in {parts.length} parts
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a part to play its audio with the matching transcript.
          </p>
        </div>
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="Recording parts"
        >
          {parts.map((part, index) => (
            <Button
              aria-pressed={part.id === activePart.id}
              key={part.id}
              onClick={() => setActivePartId(part.id)}
              size="sm"
              type="button"
              variant={part.id === activePart.id ? "default" : "outline"}
            >
              Part {index + 1}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-10">
        {partContent.map((content, index) => {
          const part = parts[index];
          const isActive = part?.id === activePart.id;
          const transcript = isValidElement(content)
            ? cloneElement(
                content as ReactElement<{ audioUrl?: string | null }>,
                { audioUrl: isActive ? part?.audioUrl : null },
              )
            : content;

          return (
            <section
              className={index > 0 ? "border-t pt-8" : undefined}
              key={part?.id ?? index}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  Part {index + 1} transcript
                </h3>
                <Button
                  aria-pressed={isActive}
                  onClick={() => part && setActivePartId(part.id)}
                  size="sm"
                  type="button"
                  variant={isActive ? "secondary" : "outline"}
                >
                  {isActive ? "Audio active" : `Use Part ${index + 1} audio`}
                </Button>
              </div>
              {transcript}
            </section>
          );
        })}
      </div>
    </section>
  );
}
