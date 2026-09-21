import { cn } from "@/lib/cn"

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  title?: string
}

/** Small pill switch used for the unit toggle and the model picker. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "bg-surface-2 border-border inline-flex gap-0.5 rounded-lg border p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[0.4rem] px-2.5 py-1 text-xs font-medium transition-all",
              "disabled:opacity-50",
              active
                ? "bg-accent text-accent-fg shadow-sm"
                : "text-muted hover:text-fg",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
