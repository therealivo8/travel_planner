import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoteTally } from "@/types";

interface Props {
  tally: VoteTally | undefined;
  onVote: (value: -1 | 0 | 1) => void;
  disabled?: boolean;
  className?: string;
}

/** 👍/👎 with counts and the first few voters' initials. Clicking your current vote clears it. */
export function VoteButtons({ tally, onVote, disabled, className }: Props) {
  const mine = tally?.mine ?? 0;
  const voters = tally?.voters ?? [];
  const btn = (value: 1 | -1, count: number, Icon: typeof ThumbsUp, label: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={mine === value}
      aria-label={`${label} (${count})`}
      onClick={() => onVote(mine === value ? 0 : value)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        mine === value
          ? "border-primary-500 bg-primary-50 text-primary-800"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
        disabled && "opacity-50"
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {count}
    </button>
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {btn(1, tally?.up ?? 0, ThumbsUp, "Vote up")}
      {btn(-1, tally?.down ?? 0, ThumbsDown, "Vote down")}
      {voters.length > 0 && (
        <span className="flex -space-x-1.5" aria-label={`Voted: ${voters.map((v) => v.name).join(", ")}`}>
          {voters.slice(0, 4).map((v) => (
            <span
              key={v.user_id}
              title={`${v.name} ${v.value > 0 ? "👍" : "👎"}`}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-white bg-neutral-200 text-[9px] font-semibold text-neutral-700"
            >
              {v.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
