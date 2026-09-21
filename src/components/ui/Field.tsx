import type { InputHTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/cn"

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-muted text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="text-muted block text-[11px]">{hint}</span> : null}
    </label>
  )
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "bg-surface-2 border-border h-9 w-full rounded-lg border px-3 text-sm",
        "placeholder:text-muted/70 focus:border-accent outline-none transition-colors",
        className,
      )}
      {...props}
    />
  )
}
