import { getSupabase } from "@/lib/supabase"

export type DimensionEntry = {
  /** Label as it appears on the drawing (L1, H1, W, H, A, B, R1…). */
  label: string
  /** Numeric value as a string (preserves any unit suffix found in the image). */
  value: string
}

export type RowHoles = {
  bHoles: number
  sHoles: number
  bCutouts: number
  wCutouts: number
  sCutouts: number
}

export type ExtractedDrawing = {
  /** window | door | partition | glass_panel | facade | other */
  drawingType: string
  unit: "mm" | "inch" | "ft" | "unknown"
  /** Width family — L1, L2… or W1, W2… */
  widths: DimensionEntry[]
  /** Height family — H1, H2… */
  heights: DimensionEntry[]
  /** Anything else labelled — diagonals, offsets. */
  other: DimensionEntry[]
  /** Per-piece hole/cutout counts, indexed to the widths/heights pairs. */
  rowHoles: RowHoles[]
  /** Per-row piece count from tabular drawings ("W x H - QTY"). */
  rowQty: number[]
  bHoles: number
  sHoles: number
  bCutouts: number
  wCutouts: number
  sCutouts: number
  panes: number | null
  notes: string
  confidence: "high" | "medium" | "low"
}

export type AIProvider = "auto" | "cloudflare" | "gemini" | "nvidia"

export type ImageInput = { imageBase64: string; mimeType: string }

export type ExtractionMeta = {
  /** Provider that actually served the request. */
  provider?: AIProvider
  /** Diagnostic chain of failures from the providers tried before it. */
  trail?: string[]
}

export const PROVIDER_LABEL: Record<AIProvider, string> = {
  auto: "Auto",
  cloudflare: "Cloudflare",
  gemini: "Gemini",
  nvidia: "Nemotron",
}

/** Read a File into the bare base64 payload (no data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      const result = String(reader.result ?? "")
      const comma = result.indexOf(",")
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

const isQuotaMsg = (s: string) => {
  const l = s.toLowerCase()
  return (
    l.includes("quota") ||
    l.includes("exceeded") ||
    l.includes("429") ||
    l.includes("rate limit")
  )
}

/**
 * Call the Supabase edge function `extract-drawing`. Accepts one or more
 * images; multi-image requests are merged by the model into a single result.
 */
export async function extractDimensions(
  images: ImageInput | ImageInput[],
  provider: AIProvider = "auto",
): Promise<ExtractedDrawing & { __meta: ExtractionMeta }> {
  const imagesArr = Array.isArray(images) ? images : [images]
  const supa = getSupabase()
  const { data, error } = await supa.functions.invoke<{
    raw?: string
    error?: string
    provider?: string
    trail?: string[]
  }>("extract-drawing", {
    body: provider === "auto" ? { images: imagesArr } : { images: imagesArr, provider },
  })

  if (error) {
    const ctx = (error as { context?: unknown }).context
    let status = 0
    let detail = error.message || "Edge function call failed"
    if (ctx instanceof Response) {
      status = ctx.status
      try {
        const body = (await ctx.clone().json()) as { error?: unknown }
        if (typeof body?.error === "string") detail = body.error
      } catch {
        try {
          const text = await ctx.clone().text()
          if (text) detail = text
        } catch {
          // keep error.message
        }
      }
    }
    if (status === 429 || isQuotaMsg(detail)) {
      throw new Error("Rate limit exceeded — try again in a moment")
    }
    throw new Error(detail)
  }
  if (!data) throw new Error("Empty response from extract-drawing")
  if (data.error) {
    throw new Error(
      isQuotaMsg(data.error) ? "Rate limit exceeded — try again in a moment" : data.error,
    )
  }
  if (!data.raw) throw new Error("Malformed response from extract-drawing")

  return {
    ...normalize(safeParse(data.raw)),
    __meta: {
      provider: (data.provider ?? "gemini") as AIProvider,
      trail: data.trail,
    },
  }
}

function safeParse(text: string): Partial<ExtractedDrawing> {
  try {
    return JSON.parse(text) as Partial<ExtractedDrawing>
  } catch {
    return {}
  }
}

/** Always return a fully-shaped object — the UI never deals with missing fields. */
export function normalize(raw: Partial<ExtractedDrawing>): ExtractedDrawing {
  const entries = (v: unknown): DimensionEntry[] =>
    Array.isArray(v)
      ? v
          .filter(
            (x): x is { label?: unknown; value?: unknown } =>
              typeof x === "object" && x !== null,
          )
          .map((x) => ({ label: String(x.label ?? ""), value: String(x.value ?? "") }))
          .filter((d) => d.label && d.value)
      : []

  const intOr0 = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0

  const rowQty: number[] = Array.isArray(raw.rowQty)
    ? raw.rowQty.map((q) => {
        const n = typeof q === "number" ? q : parseInt(String(q), 10)
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
      })
    : []

  const rowHoles: RowHoles[] = Array.isArray(raw.rowHoles)
    ? raw.rowHoles.map((r) => {
        const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>
        return {
          bHoles: intOr0(o.bHoles),
          sHoles: intOr0(o.sHoles),
          bCutouts: intOr0(o.bCutouts),
          wCutouts: intOr0(o.wCutouts),
          sCutouts: intOr0(o.sCutouts),
        }
      })
    : []

  return {
    drawingType: typeof raw.drawingType === "string" ? raw.drawingType : "other",
    unit:
      raw.unit === "mm" || raw.unit === "inch" || raw.unit === "ft" ? raw.unit : "unknown",
    widths: entries(raw.widths),
    heights: entries(raw.heights),
    other: entries(raw.other),
    rowHoles,
    rowQty,
    bHoles: intOr0(raw.bHoles),
    sHoles: intOr0(raw.sHoles),
    bCutouts: intOr0(raw.bCutouts),
    wCutouts: intOr0(raw.wCutouts),
    sCutouts: intOr0(raw.sCutouts),
    panes: typeof raw.panes === "number" ? raw.panes : null,
    notes: typeof raw.notes === "string" ? raw.notes : "",
    confidence:
      raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
        ? raw.confidence
        : "medium",
  }
}
