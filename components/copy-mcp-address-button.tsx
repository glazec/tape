"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyMcpAddressButton({ address }: { address: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="w-full sm:w-auto">
      <Button
        className="min-h-11 w-full sm:min-h-8 sm:w-auto"
        onClick={copyAddress}
        type="button"
      >
        {status === "copied" ? <Check /> : <Copy />}
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Try again"
            : "Copy MCP server link"}
      </Button>
      {status === "failed" ? (
        <p className="mt-1 max-w-56 text-xs leading-5 text-destructive">
          Could not copy. Select the link below.
        </p>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {status === "copied"
          ? "MCP address copied."
          : status === "failed"
            ? "Could not copy the MCP address."
            : ""}
      </span>
    </div>
  );
}
