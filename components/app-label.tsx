import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "@/lib/utils";

/** For places that need the label style on an element they already render. */
export const appLabelClassName =
  "font-mono text-label font-medium uppercase tracking-[0.2em] text-muted-foreground";

type AppLabelProps<T extends ElementType> = {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

/**
 * The workspace's small section label: IBM Plex Mono, 11px, uppercase, tracked
 * wide and muted. It names a group; it never repeats the heading below it.
 */
export function AppLabel<T extends ElementType = "p">({
  as,
  className,
  ...props
}: AppLabelProps<T>) {
  const Component: ElementType = as ?? "p";

  return (
    <Component
      className={cn(appLabelClassName, className)}
      {...props}
    />
  );
}
