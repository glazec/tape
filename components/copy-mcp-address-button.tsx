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
    <>
      <Button
        className="min-h-11 sm:min-h-8"
        onClick={copyAddress}
        size="sm"
        type="button"
        variant="outline"
      >
        {status === "copied" ? <Check /> : <Copy />}
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Could not copy"
            : "Copy address"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {status === "copied"
          ? "MCP address copied."
          : status === "failed"
            ? "Could not copy the MCP address."
            : ""}
      </span>
    </>
  );
}
