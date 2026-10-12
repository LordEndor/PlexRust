import { ChevronsRight } from "lucide-react";

import type { SkipOffer } from "@/lib/skips";
import { cn } from "@/lib/utils";

/**
 * Skip intro/recap/credits/outro. Set to skip automatically, it fills with
 * white first (pausing with the video) and skips when full; a click skips now.
 */
export function SkipButton({
  skip,
  paused,
  raised,
  onSkip,
}: {
  skip: SkipOffer;
  paused: boolean;
  /** Controls are showing, so sit above them. */
  raised: boolean;
  onSkip: () => void;
}) {
  const auto = skip.autoSecs != null;
  return (
    <button
      type="button"
      onClick={onSkip}
      className={cn(
        "absolute right-8 z-10 flex h-10 items-center gap-2 overflow-hidden rounded-md px-6 text-sm font-medium shadow-lg transition-[bottom] duration-300 outline-none focus-visible:ring-2 focus-visible:ring-white/60 [&_svg]:size-4",
        auto ? "border border-white/40 bg-black/55 text-white backdrop-blur" : "bg-white text-black hover:bg-white/90",
        raised ? "bottom-36" : "bottom-10",
      )}
    >
      {auto && (
        <span
          key={skip.id}
          aria-hidden
          className="absolute inset-0 origin-left bg-white"
          style={{
            animation: `skip-fill ${skip.autoSecs}s linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
          onAnimationEnd={onSkip}
        />
      )}
      {/* Inverts over the fill, so the label reads on both halves. */}
      <span className={cn("relative flex items-center gap-2", auto && "mix-blend-difference")}>
        <ChevronsRight /> {skip.label}
      </span>
    </button>
  );
}
