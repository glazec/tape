"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

function Slider({
  className,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      className={cn("flex w-full touch-none items-center select-none", className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full items-center py-2">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-ink/12">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-brand-ink" />
          <SliderPrimitive.Thumb
            aria-label="Value"
            className="block size-4 cursor-grab rounded-full border border-ink/20 bg-paper shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-ink active:cursor-grabbing"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
