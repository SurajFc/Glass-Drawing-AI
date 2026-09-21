import type { KeyboardEvent, ReactNode } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/cn"
import { blankRow, fmt, rowMetrics, sheetTotals, type SheetRow, type SizeUnit } from "@/lib/rows"

/** Enter / arrow-up / arrow-down move focus down the same column, so a whole
 *  column of sizes can be corrected without reaching for the mouse. */
function moveFocus(e: KeyboardEvent<HTMLInputElement>) {
  const key = e.key
  if (key !== "Enter" && key !== "ArrowUp" && key !== "ArrowDown") return
  const input = e.currentTarget
  const td = input.closest("td")
  const tr = td?.closest("tr")
  const tbody = tr?.closest("tbody")
  if (!td || !tr || !tbody) return

  const col = Array.from(tr.children).indexOf(td)
  const rowIndex = Array.from(tbody.children).indexOf(tr)
  const target = tbody.children[key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1]
  const next = target?.children[col]?.querySelector("input")
  if (next) {
    e.preventDefault()
    next.focus()
    next.select()
  }
}

function CellInput({
  value,
  onChange,
  type = "text",
  align = "right",
  placeholder,
  invalid,
}: {
  value: string | number
  onChange: (v: string) => void
  type?: "text" | "number"
  align?: "left" | "right"
  placeholder?: string
  invalid?: boolean
}) {
  return (
    <input
      className={cn(
        "cell-input",
        align === "right" ? "text-right" : "text-left",
        invalid && "border-danger/60 text-danger",
      )}
      type={type}
      inputMode={type === "number" ? "numeric" : undefined}
      min={type === "number" ? 0 : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={moveFocus}
      onFocus={(e) => e.currentTarget.select()}
    />
  )
}

const TH = ({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) => (
  <th
    className={cn(
      "text-muted px-2 py-2 text-[11px] font-semibold tracking-wide uppercase",
      className,
    )}
  >
    {children}
  </th>
)

export function ResultsTable({
  rows,
  unit,
  rate,
  weightPerSqft,
  onChange,
}: {
  rows: SheetRow[]
  unit: SizeUnit
  rate: number
  weightPerSqft: number
  onChange: (rows: SheetRow[]) => void
}) {
  const showAmount = rate > 0
  const totals = sheetTotals(rows, unit, rate, weightPerSqft)

  const patch = (id: string, changes: Partial<SheetRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...changes } : r)))

  const num = (v: string) => {
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  return (
    <div className="space-y-3">
      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-surface-2 border-border border-b">
            <tr>
              <TH className="w-9">#</TH>
              <TH className="w-20 text-left">Label</TH>
              <TH className="text-right">W ({unit})</TH>
              <TH className="text-right">H ({unit})</TH>
              <TH className="w-14 text-right">Qty</TH>
              <TH className="w-16 text-right">Holes</TH>
              <TH className="w-16 text-right">C/O</TH>
              <TH className="w-16 text-right">Ch. W″</TH>
              <TH className="w-16 text-right">Ch. H″</TH>
              <TH className="w-20 text-right">Area</TH>
              {showAmount && <TH className="w-24 text-right">Amount</TH>}
              <TH className="w-9" />
            </tr>
          </thead>

          <tbody>
            {rows.map((row, i) => {
              const m = rowMetrics(row, unit, rate)
              const missing = !row.width.trim() || !row.height.trim()
              return (
                <tr
                  key={row.id}
                  className="border-border hover:bg-surface-2/60 border-b last:border-0"
                >
                  <td className="text-muted px-2 text-center text-xs tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-1">
                    <CellInput
                      value={row.label}
                      align="left"
                      placeholder={`R${i + 1}`}
                      onChange={(v) => patch(row.id, { label: v })}
                    />
                  </td>
                  <td className="px-1">
                    <CellInput
                      value={row.width}
                      invalid={!row.width.trim()}
                      placeholder="—"
                      onChange={(v) => patch(row.id, { width: v })}
                    />
                  </td>
                  <td className="px-1">
                    <CellInput
                      value={row.height}
                      invalid={!row.height.trim()}
                      placeholder="—"
                      onChange={(v) => patch(row.id, { height: v })}
                    />
                  </td>
                  <td className="px-1">
                    <CellInput
                      type="number"
                      value={row.qty}
                      onChange={(v) => patch(row.id, { qty: Math.max(1, num(v)) })}
                    />
                  </td>
                  <td className="px-1">
                    <CellInput
                      type="number"
                      value={row.holes}
                      onChange={(v) => patch(row.id, { holes: num(v) })}
                    />
                  </td>
                  <td className="px-1">
                    <CellInput
                      type="number"
                      value={row.cutouts}
                      onChange={(v) => patch(row.id, { cutouts: num(v) })}
                    />
                  </td>
                  <td className="text-muted px-2 text-right text-xs tabular-nums">
                    {m.chargeW || "—"}
                  </td>
                  <td className="text-muted px-2 text-right text-xs tabular-nums">
                    {m.chargeH || "—"}
                  </td>
                  <td
                    className={cn(
                      "px-2 text-right text-xs tabular-nums",
                      missing ? "text-muted" : "font-medium",
                    )}
                  >
                    {fmt(m.area)}
                  </td>
                  {showAmount && (
                    <td className="px-2 text-right text-xs font-medium tabular-nums">
                      {fmt(m.amount)}
                    </td>
                  )}
                  <td className="px-1 text-center">
                    <button
                      type="button"
                      aria-label={`Delete row ${i + 1}`}
                      onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                      className="text-muted hover:text-danger rounded p-1 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>

          <tfoot className="bg-surface-2 border-border border-t">
            <tr className="text-xs font-semibold">
              <td />
              <td className="px-2 py-2">TOTAL</td>
              <td />
              <td />
              <td className="px-2 text-right tabular-nums">{totals.pieces}</td>
              <td className="px-2 text-right tabular-nums">{totals.holes}</td>
              <td className="px-2 text-right tabular-nums">{totals.cutouts}</td>
              <td />
              <td />
              <td className="px-2 text-right tabular-nums">{fmt(totals.area)}</td>
              {showAmount && (
                <td className="px-2 text-right tabular-nums">{fmt(totals.amount)}</td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <Button size="sm" onClick={() => onChange([...rows, blankRow()])}>
        <Plus className="size-3.5" />
        Add row
      </Button>
    </div>
  )
}
