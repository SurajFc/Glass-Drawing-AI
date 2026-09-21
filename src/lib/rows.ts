import type { ExtractedDrawing } from "@/lib/extract"

export type SizeUnit = "mm" | "in"

/** One editable line of the results table: a single W × H dimension pair. */
export type SheetRow = {
  id: string
  /** Label carried over from the drawing (L1, R1, A…). */
  label: string
  /** Actual cut width, as typed, in the sheet's unit. May be "1200/1220". */
  width: string
  /** Actual cut height, as typed, in the sheet's unit. */
  height: string
  qty: number
  /** Holes on ONE piece (big + small combined). */
  holes: number
  /** Cutouts on ONE piece (big + W + small combined). */
  cutouts: number
}

export type RowMetrics = {
  /** Chargeable width, rounded up to the standard size, in inches. */
  chargeW: number
  /** Chargeable height, rounded up to the standard size, in inches. */
  chargeH: number
  /** Chargeable area for the whole row (all pieces), in sq.ft. */
  area: number
  /** area × rate. */
  amount: number
}

const MM_PER_INCH = 25.4

let seq = 0
export const newId = () => `r${++seq}-${Math.random().toString(36).slice(2, 7)}`

export function blankRow(label = ""): SheetRow {
  return { id: newId(), label, width: "", height: "", qty: 1, holes: 0, cutouts: 0 }
}

/**
 * Round an actual cutting dimension (mm) up to the standard chargeable size
 * in inches. Standards: 12, 15, 18, 21, 24, then +6 each step (30, 36, 42…).
 */
export function standardSizeInches(mm: number): number {
  if (!Number.isFinite(mm) || mm <= 0) return 0
  const inches = mm / MM_PER_INCH - 0.0999
  if (inches <= 12) return 12
  if (inches <= 15) return 15
  if (inches <= 18) return 18
  if (inches <= 21) return 21
  if (inches <= 24) return 24
  return Math.ceil((inches - 24) / 6) * 6 + 24
}

/**
 * Parse an actual-dimension string to mm. Slash-separated values use the MAX
 * (the chargeable size goes by the largest cut). An explicit `"` or `in`
 * suffix wins over the sheet unit.
 */
export function toMm(value: string, unit: SizeUnit): number {
  if (!value) return 0
  const explicitInches = value.includes('"') || /in\b/i.test(value)
  const nums = value
    .split("/")
    .map((p) => parseFloat(p.replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n))
  if (nums.length === 0) return 0
  const max = Math.max(...nums)
  return explicitInches || unit === "in" ? max * MM_PER_INCH : max
}

export function rowMetrics(row: SheetRow, unit: SizeUnit, rate: number): RowMetrics {
  const chargeW = standardSizeInches(toMm(row.width, unit))
  const chargeH = standardSizeInches(toMm(row.height, unit))
  const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 0
  const area = (chargeW * chargeH * qty) / 144
  return { chargeW, chargeH, area, amount: area * (Number.isFinite(rate) ? rate : 0) }
}

export type SheetTotals = {
  pieces: number
  area: number
  holes: number
  cutouts: number
  amount: number
  weight: number
}

export function sheetTotals(
  rows: SheetRow[],
  unit: SizeUnit,
  rate: number,
  weightPerSqft: number,
): SheetTotals {
  return rows.reduce<SheetTotals>(
    (acc, row) => {
      const m = rowMetrics(row, unit, rate)
      const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 0
      acc.pieces += qty
      acc.area += m.area
      acc.holes += row.holes * qty
      acc.cutouts += row.cutouts * qty
      acc.amount += m.amount
      acc.weight += m.area * (Number.isFinite(weightPerSqft) ? weightPerSqft : 0)
      return acc
    },
    { pieces: 0, area: 0, holes: 0, cutouts: 0, amount: 0, weight: 0 },
  )
}

/**
 * Turn an extraction into editable rows.
 *
 * Widths and heights are paired by index (W1↔H1, W2↔H2…). If the arrays are
 * uneven the shorter side is padded with an empty value, so every dimension
 * the model found still surfaces as a row you can fix by hand.
 */
export function rowsFromExtraction(extracted: ExtractedDrawing): SheetRow[] {
  const count = Math.max(extracted.widths.length, extracted.heights.length)
  if (count === 0) return []

  return Array.from({ length: count }, (_, i) => {
    const w = extracted.widths[i]
    const h = extracted.heights[i]
    const rh = extracted.rowHoles[i]
    const rq = extracted.rowQty[i]
    return {
      id: newId(),
      label: w?.label || h?.label || `R${i + 1}`,
      width: w?.value ?? "",
      height: h?.value ?? "",
      qty: typeof rq === "number" && rq > 0 ? rq : 1,
      holes: rh ? rh.bHoles + rh.sHoles : 0,
      cutouts: rh ? rh.bCutouts + rh.wCutouts + rh.sCutouts : 0,
    }
  })
}

/** The unit the model reported, mapped onto the sheet's two-way toggle. */
export function unitFromExtraction(extracted: ExtractedDrawing): SizeUnit | null {
  if (extracted.unit === "inch") return "in"
  if (extracted.unit === "mm") return "mm"
  return null
}

export const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const fmtCompact = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
