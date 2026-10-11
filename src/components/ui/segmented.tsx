import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: string;
}

/** A row of mutually exclusive choices, styled like shadcn's tabs list. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("bg-muted inline-flex h-9 items-center rounded-lg p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "text-muted-foreground hover:text-foreground h-full rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
            o.value === value && "bg-background text-foreground dark:bg-input/40 shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
