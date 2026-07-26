import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The public site adds its own font-size scale (`text-display-1`, `text-lede`,
 * `text-label`). tailwind-merge cannot infer those from the theme, so without
 * registering them it reads `text-display-2` as a text *color* and drops it
 * whenever a real color like `text-ink` follows in the same `cn()` call.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display-1", "display-2", "display-3", "lede", "label"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
