# Glass Drawing AI

Upload a glass drawing, get its dimensions read out by a vision model, fix anything
the model got wrong in a live table, and export the result to Excel or PDF.

Standalone single-purpose app — the Drawing AI feature from Balajee ERP, on its own,
with a new UI.

---

## What it does

1. **Read** — drop in one or more drawing images (or paste a screenshot). A vision
   model returns every width/height pair it can find, plus per-piece quantities,
   holes and cutouts.
2. **Fix** — every value lands in an editable table. Correct a size, change a
   quantity, add or delete a row; the chargeable sizes, area and amount recompute
   as you type.
3. **Export** — download the sheet as a formatted `.xlsx` or a print-ready PDF.

Supported drawing formats:

| Format | Example |
|---|---|
| Labelled engineering drawings | dimensions named `L1`, `H1`, `W`, `H`, `A`, `B` |
| Tabular lists | `90 x 29.6 - 9` → 9 pieces of 90 × 29.6 |
| Freeform sketches | hand-drawn, as long as the measurements are legible |

### Glass maths

Chargeable sizes round each actual cut **up** to the standard ladder —
12″, 15″, 18″, 21″, 24″, then +6″ steps (30, 36, 42…).

```
area (sq.ft) = chargeW" × chargeH" × qty ÷ 144
amount       = area × rate
weight (kg)  = area × kg-per-sq.ft
```

A slash-separated value (`1200/1220`) is charged at the **larger** cut. A value
ending in `"` or `in` is read as inches whatever the sheet's unit toggle says.

---

## Stack

React 19 · TypeScript 5.7 · Vite 6 · Tailwind CSS v4 · Supabase Edge Functions (Deno)

```
src/
  App.tsx                 page shell + extraction flow
  components/             Dropzone, ResultsTable, SummaryBar, lightbox, theme toggle
  components/ui/          Button, Field/Input, Segmented
  lib/
    extract.ts            edge-function client + response normalisation
    rows.ts               row model, standard-size ladder, totals
    exportXlsx.ts         ExcelJS workbook  (loaded on demand)
    exportPdf.ts          jsPDF + autotable (loaded on demand)
    supabase.ts           lazy client
supabase/functions/
  extract-drawing/        the Deno edge function that talks to the vision models
```

The export libraries are ~1 MB together, so they are dynamically imported the first
time you export — the initial bundle stays around 90 kB gzipped.

---

## Running it

```bash
pnpm install
cp .env.example .env      # fill in your Supabase URL + anon key
pnpm dev                  # http://localhost:5173
```

Other scripts: `pnpm build`, `pnpm preview`, `pnpm type-check`, `pnpm format`.

### Frontend environment

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

The app shows a banner and disables extraction until both are set.

---

## Deploying the edge function

Provider API keys stay on the server — the browser never sees them.

```bash
supabase secrets set \
  CLOUDFLARE_API_KEY=... \
  CLOUDFLARE_ACCOUNT_ID=... \
  GEMINI_API_KEY=AIza... \
  NVIDIA_API_KEY=nvapi-...

supabase functions deploy extract-drawing
```

You only need the keys for the providers you intend to use; missing ones are
skipped in the chain.

### Provider chain

Requests run **Cloudflare → Gemini → NVIDIA** and the first success wins. A 429,
a quota error, a network failure, a non-JSON reply or a reply missing
`widths`/`heights` all fall through to the next provider. NVIDIA is last on
purpose: the small 8B model tends to hallucinate confident-looking dimensions.

| Provider | Model |
|---|---|
| Cloudflare Workers AI | `@cf/google/gemma-4-26b-a4b-it` |
| Google Gemini | `gemini-2.5-flash` |
| NVIDIA NIM | `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` |

Each provider supports up to four keys for rate-limit rotation — set
`<PROVIDER>_API_KEY` plus `_1`, `_2`, `_3`. Picking a specific model in the UI
forces it and disables the fallback, which is useful when comparing results.

The response carries which provider actually served the request and the trail of
providers that failed before it; both are shown in the UI.

---

## Deploying the frontend to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to
`main`. Two one-time settings are needed in the repository:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → New repository secret**, twice:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

Push to `main` (or run the workflow manually from the Actions tab) and the site
lands at `https://<user>.github.io/<repo>/`. Assets are built with a relative
base, so the same `dist/` also works at a domain root or in any sub-folder —
a custom domain needs no config change.

Without the secrets the build still succeeds; the deployed app just shows the
"Supabase is not configured" banner and extraction stays disabled.

### What ends up public

Both `VITE_` values are compiled into the JavaScript bundle — that is normal for
a Supabase anon key, which is guarded by row-level security. Provider API keys
are never in the bundle: they live in the edge function's secrets, server side.

Worth knowing: the deployed `extract-drawing` function can be called by anyone
who reads the anon key out of the bundle, which spends your model quota. If that
matters, put the function behind Supabase auth (`verify_jwt`) and add a sign-in,
or narrow `Access-Control-Allow-Origin` in the function from `*` to your Pages
origin.

---

## Limits

- PNG · JPEG · WebP · GIF, max 5 MB per image, up to 10 images per extraction
- 30 MB total request payload (enforced in the edge function)
- Multi-image requests are merged by the model into one result set

Extraction is a reading aid, not a source of truth — **check the sizes against the
drawing before cutting.**
