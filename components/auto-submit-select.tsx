"use client";

import { useRef } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * A select that applies itself: picking a value submits the surrounding form,
 * so a filter needs no separate Search button.
 */
export function AutoSubmitSelect({
  className,
  id,
  name,
  options,
  value,
}: {
  className?: string;
  id: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span hidden ref={anchorRef} />
      <Select
        defaultValue={value}
        items={options}
        name={name}
        onValueChange={() => {
          // The hidden input updates after this callback, so submit next tick.
          window.setTimeout(() => {
            anchorRef.current?.closest("form")?.requestSubmit();
          }, 0);
        }}
      >
        <SelectTrigger
          className={cn("h-11 w-full min-w-0 bg-background sm:h-9", className)}
          id={id}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
