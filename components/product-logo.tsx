import Image from "next/image";

import { cn } from "@/lib/utils";

export function ProductLogo({
  className,
  variant = "default",
}: {
  className?: string;
  /** "light" renders the white-wordmark lockup for dark backgrounds. */
  variant?: "default" | "light";
}) {
  return (
    <Image
      src={
        variant === "light"
          ? "/brand/tape-lockup-light.svg"
          : "/brand/tape-lockup.svg"
      }
      alt=""
      width={90}
      height={32}
      loading="eager"
      unoptimized
      className={cn("h-8 w-[90px] shrink-0", className)}
    />
  );
}
