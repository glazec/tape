import Image from "next/image";

import { cn } from "@/lib/utils";
import { blogImageUrl, type BlogImage } from "@/sanity/posts";

export function BlogCoverImage({
  image,
  className,
  sizes,
}: {
  image: BlogImage;
  className?: string;
  sizes: string;
}) {
  if (!image.asset) {
    return null;
  }

  return (
    <Image
      src={blogImageUrl(image, { width: 1600, height: 1000 })}
      alt={image.alt || ""}
      fill
      sizes={sizes}
      placeholder={image.asset.metadata?.lqip ? "blur" : "empty"}
      blurDataURL={image.asset.metadata?.lqip || undefined}
      className={cn("object-cover", className)}
    />
  );
}

export function BlogBodyImage({ image }: { image: BlogImage }) {
  if (!image.asset) {
    return null;
  }

  const dimensions = image.asset.metadata?.dimensions;
  const width = dimensions?.width || 1600;
  const height = dimensions?.height || 1000;

  return (
    <figure className="my-12">
      <Image
        src={blogImageUrl(image, { width: 1600 })}
        alt={image.alt || ""}
        width={width}
        height={height}
        sizes="(max-width: 768px) calc(100vw - 3rem), 44rem"
        placeholder={image.asset.metadata?.lqip ? "blur" : "empty"}
        blurDataURL={image.asset.metadata?.lqip || undefined}
        className="h-auto w-full rounded-xl border border-ink/10"
      />
      {image.caption ? (
        <figcaption className="mt-3 font-mono text-label leading-5 tracking-[0.08em] text-ash">
          {image.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
