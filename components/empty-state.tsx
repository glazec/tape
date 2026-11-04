import type { ReactNode } from "react";

import { AppLabel } from "@/components/app-label";
import { cn } from "@/lib/utils";

/**
 * A quiet empty state: an optional mono label, one plain sentence, and at most
 * one action (an ink pill when there is something useful to do next).
 */
export function EmptyState({
  action,
  className,
  description,
  label,
  title,
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  label?: string;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-10 text-center",
        className,
      )}
    >
      {label ? <AppLabel>{label}</AppLabel> : null}
      <p className="text-sm font-medium text-foreground text-balance">{title}</p>
      {description ? (
        <p className="max-w-[48ch] text-sm leading-6 text-muted-foreground text-pretty">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
