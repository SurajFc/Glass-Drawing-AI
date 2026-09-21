import ExcelJS from "exceljs"

import { fmtCompact, rowMetrics, sheetTotals } from "@/lib/rows"
import { downloadBlob, slugify, timestamp, type Sheet } from "@/lib/sheet"

const BORDER = "FF9CA3AF"
const thin = {
  top: { style: "thin" as const, color: { argb: BORDER } },
  bottom: { style: "thin" as const, color: { argb: BORDER } },
  left: { style: "thin" as const, color: { argb: BORDER } },
  right: { style: "thin" as const, color: { argb: BORDER } },
}

const fill = (argb: string): ExcelJS.FillPattern => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
})

/** Write the sheet to an .xlsx workbook and trigger the download. */
export async function exportSheetXlsx({ rows, meta }: Sheet): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Glass Drawing AI"
  wb.created = new Date()
  const ws = wb.addWorksheet("Extraction", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true },
  })

  const showAmount = meta.rate > 0
  const showWeight = meta.weightPerSqft > 0
  const headers = [
    "#",
    "Label",
    `Width (${meta.unit})`,
    `Height (${meta.unit})`,
    "Qty",
    "Holes",
    "Cutouts",
    'Charge W (")',
    'Charge H (")',
    "Area (sq.ft)",
  ]
  if (showAmount) headers.push("Amount")
  const lastCol = headers.length

  const colLetter = (n: number) => String.fromCharCode(64 + n)
  const span = (r: number) => `A${r}:${colLetter(lastCol)}${r}`

  // ---- Title block -------------------------------------------------------
  ws.mergeCells(span(1))
  const title = ws.getCell("A1")
  title.value = "GLASS DRAWING — EXTRACTED SIZES"
  title.font = { bold: true, size: 16 }
  title.alignment = { horizontal: "center", vertical: "middle" }
  ws.getRow(1).height = 26

  const info: string[] = []
  if (meta.party) info.push(`Party: ${meta.party}`)
  if (meta.spec) info.push(`Spec: ${meta.spec}`)
  if (showAmount) info.push(`Rate: ${fmtCompact(meta.rate)} /sq.ft`)
  info.push(`Date: ${new Date().toLocaleDateString("en-IN")}`)
  ws.mergeCells(span(2))
  const sub = ws.getCell("A2")
  sub.value = info.join("   ·   ")
  sub.font = { size: 10, color: { argb: "FF4B5563" } }
  sub.alignment = { horizontal: "center" }

  let cursor = 3
  if (meta.notes.trim()) {
    ws.mergeCells(span(cursor))
    const note = ws.getCell(`A${cursor}`)
    note.value = `Notes: ${meta.notes.trim()}`
    note.font = { size: 10, italic: true, color: { argb: "FF4B5563" } }
    note.alignment = { horizontal: "center" }
    cursor++
  }
  cursor++ // spacer row

  // ---- Header row --------------------------------------------------------
  const headerRow = ws.getRow(cursor)
  headerRow.values = headers
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } }
    cell.fill = fill("FF0F172A")
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
    cell.border = thin
  })
  headerRow.height = 22
  const headerRowNumber = cursor
  cursor++

  // ---- Body --------------------------------------------------------------
  rows.forEach((row, i) => {
    const m = rowMetrics(row, meta.unit, meta.rate)
    const values: (string | number)[] = [
      i + 1,
      row.label,
      row.width,
      row.height,
      row.qty,
      row.holes,
      row.cutouts,
      m.chargeW,
      m.chargeH,
      Number(m.area.toFixed(2)),
    ]
    if (showAmount) values.push(Number(m.amount.toFixed(2)))

    const r = ws.getRow(cursor)
    r.values = values
    r.eachCell((cell, col) => {
      cell.border = thin
      cell.font = { size: 10 }
      cell.alignment = { horizontal: col === 2 ? "left" : "center" }
      if (i % 2 === 1) cell.fill = fill("FFF3F4F6")
      if (col === 10 || col === 11) cell.numFmt = "#,##0.00"
    })
    cursor++
  })

  // ---- Totals ------------------------------------------------------------
  const totals = sheetTotals(rows, meta.unit, meta.rate, meta.weightPerSqft)
  const totalValues: (string | number)[] = [
    "",
    "TOTAL",
    "",
    "",
    totals.pieces,
    totals.holes,
    totals.cutouts,
    "",
    "",
    Number(totals.area.toFixed(2)),
  ]
  if (showAmount) totalValues.push(Number(totals.amount.toFixed(2)))

  const totalRow = ws.getRow(cursor)
  totalRow.values = totalValues
  totalRow.eachCell((cell, col) => {
    cell.border = thin
    cell.font = { bold: true, size: 10 }
    cell.fill = fill("FFE5E7EB")
    cell.alignment = { horizontal: col === 2 ? "left" : "center" }
    if (col === 10 || col === 11) cell.numFmt = "#,##0.00"
  })
  cursor++

  if (showWeight) {
    ws.mergeCells(`A${cursor}:${colLetter(lastCol)}${cursor}`)
    const w = ws.getCell(`A${cursor}`)
    w.value = `Estimated weight: ${totals.weight.toFixed(2)} kg  (${fmtCompact(meta.weightPerSqft)} kg/sq.ft)`
    w.font = { size: 10, bold: true }
    w.alignment = { horizontal: "right" }
  }

  // ---- Widths ------------------------------------------------------------
  const widths = [5, 12, 13, 13, 7, 8, 9, 12, 12, 13, 13]
  widths.slice(0, lastCol).forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
  ws.views = [{ state: "frozen", ySplit: headerRowNumber }]

  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${slugify(meta.party, "drawing")}_sizes_${timestamp()}.xlsx`,
  )
}
