"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogContent({
  className,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black/35 transition-opacity duration-200 ease-(--tape-ease-out) data-ending-style:duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
      {/* Phones get a bottom sheet within thumb reach; larger screens a centered card. */}
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex min-h-dvh items-end justify-center max-sm:pb-(--tape-keyboard-inset) max-sm:transition-[padding] max-sm:duration-200 sm:items-center sm:p-4">
        <DialogPrimitive.Popup
          className={cn(
            "w-full max-w-md rounded-lg border bg-background p-5 text-foreground shadow-xl outline-none transition-[scale,opacity,translate] duration-200 ease-(--tape-ease-out) data-ending-style:duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:translate-y-1 data-starting-style:scale-[0.96] data-starting-style:opacity-0 motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-starting-style:scale-100",
            "max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:duration-300 max-sm:ease-(--tape-ease-drawer) max-sm:data-starting-style:translate-y-full max-sm:data-starting-style:scale-100 max-sm:data-starting-style:opacity-100 max-sm:data-ending-style:translate-y-full max-sm:data-ending-style:scale-100 max-sm:data-ending-style:opacity-100 max-sm:data-ending-style:duration-200 motion-reduce:max-sm:data-starting-style:translate-y-0 motion-reduce:max-sm:data-starting-style:opacity-0 motion-reduce:max-sm:data-ending-style:translate-y-0 motion-reduce:max-sm:data-ending-style:opacity-0",
            className,
          )}
          data-slot="dialog-content"
          {...props}
        />
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogClose({
  className,
  ...props
}: DialogPrimitive.Close.Props) {
  return (
    <DialogPrimitive.Close
      className={className}
      data-slot="dialog-close"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
};
