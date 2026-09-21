import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Layers,
  RotateCcw,
  Ruler,
  Sparkles,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"

import { Dropzone, type UploadedImage } from "@/components/Dropzone"
import { ImageLightbox } from "@/components/ImageLightbox"
import { ResultsTable } from "@/components/ResultsTable"
import { SummaryBar } from "@/components/SummaryBar"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/Button"
import { Field, Input } from "@/components/ui/Field"
import { Segmented } from "@/components/ui/Segmented"
import { cn } from "@/lib/cn"
import {
  extractDimensions,
  fileToBase64,
  PROVIDER_LABEL,
  type AIProvider,
  type ExtractionMeta,
  type ImageInput,
} from "@/lib/extract"
import {
  rowsFromExtraction,
  sheetTotals,
  unitFromExtraction,
  type SheetRow,
  type SizeUnit,
} from "@/lib/rows"
import { isConfigured } from "@/lib/supabase"

const PROVIDERS: AIProvider[] = ["auto", "cloudflare", "gemini", "nvidia"]

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-ok/15 text-ok",
  medium: "bg-warn/15 text-warn",
  low: "bg-danger/15 text-danger",
}

type Extraction = ExtractionMeta & {
  confidence: string
  drawingType: string
  modelNotes: string
}

export default function App() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [preview, setPreview] = useState<UploadedImage | null>(null)
  const [provider, setProvider] = useState<AIProvider>("auto")
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null)

  const [rows, setRows] = useState<SheetRow[]>([])
  const [extraction, setExtraction] = useState<Extraction | null>(null)

  const [party, setParty] = useState("")
  const [spec, setSpec] = useState("")
  const [rateStr, setRateStr] = useState("")
  const [weightStr, setWeightStr] = useState("")
  const [unit, setUnit] = useState<SizeUnit>("mm")
  const [notes, setNotes] = useState("")

  const rate = Number(rateStr) || 0
  const weightPerSqft = Number(weightStr) || 0
  const configured = isConfigured()

  const totals = useMemo(
    () => sheetTotals(rows, unit, rate, weightPerSqft),
    [rows, unit, rate, weightPerSqft],
  )

  const sheet = () => ({
    rows,
    meta: { party, spec, rate, weightPerSqft, unit, notes },
  })

  async function runExtraction() {
    if (images.length === 0) {
      toast.error("Add at least one drawing image first")
      return
    }
    if (!configured) {
      toast.error("Supabase is not configured — see the README")
      return
    }

    setBusy(true)
    try {
      const payload: ImageInput[] = await Promise.all(
        images.map(async (img) => ({
          imageBase64: await fileToBase64(img.file),
          mimeType: img.file.type,
        })),
      )

      const result = await extractDimensions(payload, provider)
      const nextRows = rowsFromExtraction(result)

      setRows(nextRows)
      setExtraction({
        ...result.__meta,
        confidence: result.confidence,
        drawingType: result.drawingType,
        modelNotes: result.notes,
      })
      if (result.notes) setNotes(result.notes)

      const detected = unitFromExtraction(result)
      if (detected) setUnit(detected)

      if (nextRows.length === 0) {
        toast.warning("No dimensions found — try a sharper image or another model")
      } else {
        toast.success(
          `${nextRows.length} ${nextRows.length === 1 ? "row" : "rows"} extracted via ${
            PROVIDER_LABEL[result.__meta.provider ?? "auto"]
          }`,
        )
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function resetAll() {
    images.forEach((i) => URL.revokeObjectURL(i.previewUrl))
    setImages([])
    setRows([])
    setExtraction(null)
    setNotes("")
    toast.success("Cleared")
  }

  // The export libraries (exceljs, jspdf) are ~1 MB together and are only
  // needed once there is something to export, so they load on demand.
  async function downloadXlsx() {
    setExporting("xlsx")
    try {
      const { exportSheetXlsx } = await import("@/lib/exportXlsx")
      await exportSheetXlsx(sheet())
      toast.success("Excel file downloaded")
    } catch (err) {
      toast.error(`Excel export failed: ${(err as Error).message}`)
    } finally {
      setExporting(null)
    }
  }

  async function downloadPdf() {
    setExporting("pdf")
    try {
      const { exportSheetPdf } = await import("@/lib/exportPdf")
      exportSheetPdf(sheet())
      toast.success("PDF downloaded")
    } catch (err) {
      toast.error(`PDF export failed: ${(err as Error).message}`)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="border-border bg-bg/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3">
          <div className="bg-accent text-accent-fg grid size-9 place-items-center rounded-xl shadow-sm">
            <Ruler className="size-5" />
          </div>
          <div className="mr-auto">
            <h1 className="text-[15px] leading-tight font-semibold">Glass Drawing AI</h1>
            <p className="text-muted hidden text-[11px] leading-tight sm:block">
              Read sizes off a drawing · edit · export
            </p>
          </div>
          {rows.length > 0 && (
            <Button size="sm" variant="ghost" onClick={resetAll} className="no-print">
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {!configured && (
        <div className="bg-warn/10 border-warn/30 text-warn border-b px-4 py-2 text-center text-xs">
          <AlertTriangle className="mr-1 inline size-3.5 align-text-bottom" />
          Set <code className="font-mono">VITE_SUPABASE_URL</code> and{" "}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in{" "}
          <code className="font-mono">.env</code> to enable extraction.
        </div>
      )}

      <main className="mx-auto grid max-w-[1400px] gap-5 px-4 py-6 lg:grid-cols-[370px_minmax(0,1fr)]">
        {/* ---------------- Left: input panel ---------------- */}
        <div className="no-print min-w-0 space-y-4 lg:sticky lg:top-[72px] lg:self-start">
          <section className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <span className="bg-accent-soft text-accent grid size-5 place-items-center rounded-md text-[11px] font-bold">
                1
              </span>
              Drawing
            </h2>
            <Dropzone
              images={images}
              onChange={setImages}
              disabled={busy}
              onPreview={setPreview}
            />
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="bg-accent-soft text-accent grid size-5 place-items-center rounded-md text-[11px] font-bold">
                2
              </span>
              Details
              <span className="text-muted ml-auto text-[11px] font-normal">optional</span>
            </h2>

            <Field label="Party">
              <Input
                value={party}
                onChange={(e) => setParty(e.target.value)}
                placeholder="Customer name"
              />
            </Field>

            <Field label="Glass spec">
              <Input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="8mm Clear Toughened"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate /sq.ft">
                <Input
                  type="number"
                  min={0}
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Kg /sq.ft">
                <Input
                  type="number"
                  min={0}
                  value={weightStr}
                  onChange={(e) => setWeightStr(e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                <p className="text-muted text-xs font-medium tracking-wide uppercase">
                  Size unit
                </p>
                <p className="text-muted text-[11px]">How to read the drawing numbers</p>
              </div>
              <Segmented
                value={unit}
                onChange={setUnit}
                options={[
                  { value: "mm", label: "mm" },
                  { value: "in", label: "inch" },
                ]}
              />
            </div>

            <div className="border-border space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted text-xs font-medium tracking-wide uppercase">
                  Model
                </p>
                <Segmented
                  value={provider}
                  onChange={setProvider}
                  disabled={busy}
                  options={PROVIDERS.map((p) => ({
                    value: p,
                    label: PROVIDER_LABEL[p],
                    title:
                      p === "auto"
                        ? "Cloudflare → Gemini → Nemotron, first success wins"
                        : `Force ${PROVIDER_LABEL[p]} (no fallback)`,
                  }))}
                />
              </div>
              <p className="text-muted text-[11px]">
                {provider === "auto"
                  ? "Falls back through Cloudflare → Gemini → Nemotron on quota errors."
                  : `Forced to ${PROVIDER_LABEL[provider]} — no fallback if it fails.`}
              </p>
            </div>

            <Button
              size="lg"
              variant="primary"
              className="w-full"
              disabled={busy || images.length === 0 || !configured}
              onClick={runExtraction}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Reading drawing…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  {rows.length > 0 ? "Extract again" : "Extract sizes"}
                </>
              )}
            </Button>
          </section>
        </div>

        {/* ---------------- Right: results ---------------- */}
        <div className="min-w-0 space-y-4">
          {busy && rows.length === 0 ? (
            <LoadingState pages={images.length} />
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <section className="card space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto text-sm font-semibold">Extracted sizes</h2>
                  {extraction && (
                    <>
                      {extraction.drawingType !== "other" && (
                        <Badge>{extraction.drawingType.replace(/_/g, " ")}</Badge>
                      )}
                      <Badge className={CONFIDENCE_STYLE[extraction.confidence]}>
                        {extraction.confidence} confidence
                      </Badge>
                      <Badge>
                        {PROVIDER_LABEL[extraction.provider ?? "auto"]}
                        {images.length > 1 ? ` · ${images.length} pages` : ""}
                      </Badge>
                    </>
                  )}
                </div>

                <SummaryBar
                  totals={totals}
                  rate={rate}
                  weightPerSqft={weightPerSqft}
                />

                <ResultsTable
                  rows={rows}
                  unit={unit}
                  rate={rate}
                  weightPerSqft={weightPerSqft}
                  onChange={setRows}
                />

                <p className="text-muted text-[11px]">
                  Chargeable sizes round each cut up to the standard 12/15/18/21/24″ ladder,
                  then +6″ steps. Area = Ch.W × Ch.H × Qty ÷ 144.
                </p>
              </section>

              <section className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold">Notes</h2>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Anything to carry into the export…"
                  className="bg-surface-2 border-border focus:border-accent w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
                />
                {extraction?.trail?.length ? (
                  <details className="text-muted text-[11px]">
                    <summary className="cursor-pointer select-none">
                      {extraction.trail.length} provider fallback
                      {extraction.trail.length === 1 ? "" : "s"} before success
                    </summary>
                    <ul className="mt-1 space-y-0.5 font-mono">
                      {extraction.trail.map((t) => (
                        <li key={t}>· {t}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="no-print flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="primary"
                    onClick={downloadXlsx}
                    disabled={exporting !== null}
                  >
                    {exporting === "xlsx" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="size-4" />
                    )}
                    Export Excel
                  </Button>
                  <Button onClick={downloadPdf} disabled={exporting !== null}>
                    {exporting === "pdf" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                    Export PDF
                  </Button>
                </div>
                <p className="text-muted text-[11px]">
                  AI-read sizes — always check them against the drawing before cutting.
                </p>
              </section>
            </>
          )}
        </div>
      </main>

      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function Badge({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "bg-surface-2 text-muted rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        className,
      )}
    >
      {children}
    </span>
  )
}

function LoadingState({ pages }: { pages: number }) {
  return (
    <section className="card grid place-items-center gap-4 px-6 py-24 text-center">
      <div className="relative">
        <Loader2 className="text-accent size-12 animate-spin" />
        <Sparkles className="text-accent absolute inset-0 m-auto size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Reading {pages} {pages === 1 ? "drawing" : "pages"}…
        </p>
        <p className="text-muted text-xs">
          Usually 5–20 seconds. Falling back to another model if one is rate-limited.
        </p>
      </div>
    </section>
  )
}

function EmptyState() {
  const formats = [
    {
      title: "Labelled drawings",
      body: "Engineering views with named dimensions — L1, H1, W, H, A, B.",
    },
    {
      title: "Tabular lists",
      body: 'Rows like "90 x 29.6 - 9" become width, height and quantity.',
    },
    {
      title: "Freeform sketches",
      body: "Hand sketches, as long as the measurements are legible.",
    },
  ]
  return (
    <section className="card grid place-items-center gap-6 px-6 py-16 text-center">
      <div className="bg-accent-soft text-accent grid size-14 place-items-center rounded-2xl">
        <Layers className="size-7" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold">No drawing read yet</p>
        <p className="text-muted mx-auto max-w-sm text-sm">
          Add a drawing on the left and hit Extract. Every size lands in a table you can
          correct before exporting.
        </p>
      </div>
      <ul className="grid gap-3 text-left sm:grid-cols-3">
        {formats.map((f) => (
          <li key={f.title} className="bg-surface-2 border-border rounded-lg border p-3">
            <p className="text-xs font-semibold">{f.title}</p>
            <p className="text-muted mt-1 text-[11px] leading-snug">{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
