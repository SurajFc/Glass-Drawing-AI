import type { SheetRow, SizeUnit } from "@/lib/rows"

/** Everything the exports need besides the rows themselves. */
export type SheetMeta = {
  /** Customer / party the drawing belongs to. */
  party: string
  /** Glass specification, e.g. "8mm Clear Toughened". */
  spec: string
  /** Rate per sq.ft. */
  rate: number
  /** Kg per sq.ft, used for the weight total. 0 hides the weight column. */
  weightPerSqft: number
  unit: SizeUnit
  /** Free text carried into the export header. */
  notes: string
}

export type Sheet = { rows: SheetRow[]; meta: SheetMeta }

export const blankMeta = (): SheetMeta => ({
  party: "",
  spec: "",
  rate: 0,
  weightPerSqft: 0,
  unit: "mm",
  notes: "",
})

export function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

export function slugify(name: string, fallback: string): string {
  const s = (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return s || fallback
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
