import type { ImageAsset } from "@/domain/product";
import { cn } from "@/lib/cn";
import { DemoArt } from "./DemoArt";

// Renders any ImageAsset. Demo placeholders are procedural; real assets use a
// plain img with lazy loading until an approved asset pipeline exists.
export function ImageFrame({
  image,
  ratio = "4/5",
  className,
  priority = false,
}: {
  image: ImageAsset | undefined;
  ratio?: "1/1" | "4/5" | "4/3" | "16/9" | "3/4";
  className?: string;
  priority?: boolean;
}) {
  const aspect = { "1/1": "aspect-square", "4/5": "aspect-[4/5]", "4/3": "aspect-[4/3]", "16/9": "aspect-video", "3/4": "aspect-[3/4]" }[ratio];
  return (
    <div className={cn("relative overflow-hidden bg-ivory-deep", aspect, className)}>
      {!image ? (
        <DemoArt seed="default" className="absolute inset-0 h-full w-full" />
      ) : image.src.startsWith("demo:") ? (
        <DemoArt seed={image.src.slice(5)} label={image.alt} className="absolute inset-0 h-full w-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

export function primaryImage(images: ImageAsset[]): ImageAsset | undefined {
  return images.find((i) => i.role === "card") ?? images.find((i) => i.role === "primary") ?? images[0];
}
