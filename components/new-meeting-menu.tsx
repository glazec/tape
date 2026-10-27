"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ChevronDown, FileText, UploadCloud } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const sourceShortcuts = [
  { icon: Bot, label: "From a meeting link", source: "link" },
  { icon: UploadCloud, label: "Upload a recording", source: "recording" },
  { icon: FileText, label: "Paste a transcript", source: "transcript" },
] as const;

/**
 * The primary create action, with the common sources one step away so the
 * chooser page is only needed when someone wants to browse.
 */
export function NewMeetingMenu({ active = false }: { active?: boolean }) {
  const router = useRouter();

  return (
    <div className="ml-2 flex items-center">
      <Link
        href="/meetings/new"
        aria-current={active ? "page" : undefined}
        data-telemetry-action="nav_meetings_new"
        className={cn(
          buttonVariants({ variant: "default", size: "sm" }),
          "min-h-11 rounded-r-none shadow-none sm:min-h-8",
        )}
      >
        New meeting
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Choose how to add a meeting"
              className="min-h-11 rounded-l-none border-l border-l-primary-foreground/20 px-1.5 shadow-none sm:min-h-8"
              size="sm"
              type="button"
            />
          }
        >
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {sourceShortcuts.map((shortcut) => (
            <DropdownMenuItem
              key={shortcut.source}
              onClick={() =>
                router.push(`/meetings/new?source=${shortcut.source}`)
              }
            >
              <shortcut.icon aria-hidden="true" />
              {shortcut.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
