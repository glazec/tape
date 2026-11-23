"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  getInstallState,
  getServerInstallState,
  promptInstall,
  subscribeInstallState,
} from "@/lib/pwa-install-store";

const itemClassName =
  "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

/**
 * Account menu entry that installs Tape as an app. Hidden once installed and
 * on browsers that cannot install, so it never offers an action that fails.
 */
export function InstallAppMenuItem() {
  const install = useSyncExternalStore(
    subscribeInstallState,
    getInstallState,
    getServerInstallState,
  );
  const [iosOpen, setIosOpen] = useState(false);

  if (install.standalone) return null;

  if (install.canPrompt) {
    return (
      <button
        className={itemClassName}
        data-closes-menu=""
        data-telemetry-action="pwa_install_prompted"
        onClick={() => void promptInstall()}
        type="button"
      >
        <Download aria-hidden="true" className="size-4 text-muted-foreground" />
        Install app
      </button>
    );
  }

  if (!install.iosManual) return null;

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={itemClassName}
        data-closes-menu=""
        data-telemetry-action="pwa_install_ios_help"
        onClick={() => setIosOpen(true)}
        type="button"
      >
        <SquarePlus aria-hidden="true" className="size-4 text-muted-foreground" />
        Add to Home Screen
      </button>
      <Dialog onOpenChange={setIosOpen} open={iosOpen}>
        <DialogContent>
          <DialogTitle>Add Tape to your Home Screen</DialogTitle>
          <DialogDescription className="mt-2">
            Open Tape like an app, full screen, and record a meeting in one tap.
          </DialogDescription>
          <ol className="mt-5 flex flex-col gap-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Share aria-hidden="true" className="size-4" />
              </span>
              <span>
                Tap <span className="font-medium">Share</span> in the Safari toolbar.
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <SquarePlus aria-hidden="true" className="size-4" />
              </span>
              <span>
                Choose <span className="font-medium">Add to Home Screen</span>, then Add.
              </span>
            </li>
          </ol>
          <div className="mt-6 flex justify-end">
            <DialogClose className={buttonVariants({ variant: "outline" })}>
              Done
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
