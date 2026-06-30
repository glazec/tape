"use client";

import { useState } from "react";
import Image from "next/image";

export function OrganizationLogoImage({ domains }: { domains: string[] }) {
  const [domainIndex, setDomainIndex] = useState(0);
  const domain = domains[domainIndex];

  if (!domain) {
    return null;
  }

  return (
    <Image
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-sm"
      height={16}
      loading="lazy"
      onError={() => setDomainIndex((current) => current + 1)}
      referrerPolicy="no-referrer"
      src={getFaviconUrl(domain)}
      unoptimized
      width={16}
    />
  );
}

function getFaviconUrl(domain: string) {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}
