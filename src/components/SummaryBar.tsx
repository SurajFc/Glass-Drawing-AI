import { fmt, fmtCompact, type SheetTotals } from "@/lib/rows"

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-2 border-border rounded-lg border px-3 py-2">
      <p className="text-muted text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-lg leading-tight font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-muted text-[10px]">{sub}</p> : null}
    </div>
  )
}

/** Totals strip above the table. Amount and weight only appear once their
 *  per-sq.ft input has a value, so the strip never shows a meaningless 0. */
export function SummaryBar({
  totals,
  rate,
  weightPerSqft,
}: {
  totals: SheetTotals
  rate: number
  weightPerSqft: number
}) {
  const stats = [
    { label: "Pieces", value: String(totals.pieces) },
    { label: "Area", value: fmt(totals.area), sub: "sq.ft chargeable" },
    { label: "Holes", value: String(totals.holes), sub: "across all pieces" },
    { label: "Cutouts", value: String(totals.cutouts), sub: "across all pieces" },
  ]

  if (rate > 0) {
    stats.push({
      label: "Amount",
      value: fmt(totals.amount),
      sub: `@ ${fmtCompact(rate)} /sq.ft`,
    })
  }
  if (weightPerSqft > 0) {
    stats.push({
      label: "Weight",
      value: fmt(totals.weight),
      sub: `kg @ ${fmtCompact(weightPerSqft)} /sq.ft`,
    })
  }
  if (rate === 0 && weightPerSqft === 0) {
    stats.push({ label: "Amount", value: "—", sub: "set a rate to price it" })
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
      {stats.map((s) => (
        <Stat key={s.label} {...s} />
      ))}
    </div>
  )
}
