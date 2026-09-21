// Supabase Edge Function: extract-drawing
//
// Forwards a base64 image to a vision-capable LLM and returns the
// structured dimension extraction. Provider API keys never leave the
// server.
//
// Auto-fallback chain (in order):
//   1. Cloudflare Workers AI — @cf/google/gemma-4-26b-a4b-it
//   2. Google Gemini         — gemini-2.5-flash
//   3. NVIDIA NIM            — nvidia/llama-3.1-nemotron-nano-vl-8b-v1
//      (NVIDIA last — small 8B model tends to hallucinate generic
//       dimensions with high confidence, so we only try it after
//       stronger providers fail.)
//
// If a provider returns 429 / quota / network error, the function
// falls through to the next provider. The first success wins. The
// response includes a `provider` field so the client can show which
// model actually served the request.
//
// Rate-limit resilience: each provider supports up to 4 API tokens
// via <PROVIDER>_API_KEY (primary) plus _1, _2, _3 fallbacks.
// Cloudflare additionally needs CLOUDFLARE_ACCOUNT_ID.
//
// Deploy:
//   supabase secrets set \
//     NVIDIA_API_KEY=nvapi-... \
//     CLOUDFLARE_API_KEY=... \
//     CLOUDFLARE_ACCOUNT_ID=... \
//     GEMINI_API_KEY=AIza...
//   supabase functions deploy extract-drawing

const GEMINI_MODEL = "gemini-2.5-flash"
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const NVIDIA_MODEL = "nvidia/llama-3.1-nemotron-nano-vl-8b-v1"
const NVIDIA_API = "https://integrate.api.nvidia.com/v1/chat/completions"

// Cloudflare Workers AI vision model. Uses Cloudflare's OpenAI-compatible
// gateway so the request shape matches NVIDIA's. Requires an account ID
// in the path.
// Gemma 4 (26B MoE, ~4B active params). Built from Gemini 3 research —
// strong OCR + structured JSON output, better than the previous Llama
// 3.2 11B Vision on technical drawings.
const CLOUDFLARE_MODEL = "@cf/google/gemma-4-26b-a4b-it"

/** Prepended when more than one page image is supplied. */
function multiPagePreamble(n: number): string {
  return `You are viewing ${n} pages of the same drawing document. Combine ALL dimensions visible across ALL pages into a single unified JSON. Do not duplicate rows that appear on multiple pages.\n\n`
}

const PROMPT = `You are an expert at reading architectural and glass installation drawings. Your ONLY job is to return valid JSON. Do NOT explain, describe, or add any text before or after the JSON.

Supported drawing formats:
 (a) Labelled engineering drawings with named dimensions (L1, H1, W, H, A, B…)
 (b) Tabular lists in the form "WIDTH x HEIGHT - QTY" (e.g. "90 x 29.6 - 9" = 9 pieces of 90 wide x 29.6 tall)
 (c) Freeform sketches with visible measurements

CRITICAL RULES:
- Output ONLY a single JSON object. No markdown. No code fences. No explanation. No preamble. No summary.
- DO NOT copy the example values below. Read the ACTUAL numbers from the image.
- For format (b) tabular lists: each row like "W x H - QTY" becomes ONE entry in widths, ONE entry in heights, and the QTY goes into rowQty. Do NOT split width and height into separate rows.

EXAMPLE — if the image shows a table with rows:
  90 x 29.6 - 9
  93.4 x 31.2 - 6
  56 x 54 - 2
Then the correct output is:
  widths: [{label:"R1",value:"90"}, {label:"R2",value:"93.4"}, {label:"R3",value:"56"}]
  heights: [{label:"R1",value:"29.6"}, {label:"R2",value:"31.2"}, {label:"R3",value:"54"}]
  rowQty: [9, 6, 2]

Return this JSON schema (fill with real values from the image):

{
  "drawingType": "<window | door | partition | glass_panel | facade | other>",
  "unit": "<mm | inch | ft | unknown>",
  "widths":  [{"label": "<string>", "value": "<number as string>"}],
  "heights": [{"label": "<string>", "value": "<number as string>"}],
  "other":   [{"label": "<string>", "value": "<number as string>"}],
  "rowQty":  [<int, default 1>],
  "rowHoles": [
    {"bHoles": 0, "sHoles": 0, "bCutouts": 0, "wCutouts": 0, "sCutouts": 0}
  ],
  "bHoles":   0,
  "sHoles":   0,
  "bCutouts": 0,
  "wCutouts": 0,
  "sCutouts": 0,
  "panes":    null,
  "notes":    "",
  "confidence": "<high | medium | low>"
}

FIELD DEFINITIONS:
- bHoles: big holes (>= 12mm, for handles/fittings)
- sHoles: small holes (< 12mm, for screws/pins)
- bCutouts: big rectangular cutouts (lock cases, large notches)
- wCutouts: W-shaped cutouts (corner/waterfall)
- sCutouts: small cutouts (small notches)
- rowHoles: per-item counts, indexed to match widths/heights pairs

RULES:
- Always return ALL fields. Empty array [] for unknown arrays, 0 for unknown counts, null for panes, "" for notes, "unknown" for unit, "other" for drawingType.
- Preserve original labels (L1, H1, W, H, A, B, R1, etc.).
- Strip unit suffixes from values — put unit in "unit" field only.
- If labels are not shown, auto-generate as R1, R2, R3…
- rowHoles length must equal max(widths.length, heights.length). Pad with all-zero entries if needed.
- Set confidence "low" if dimensions are illegible or guessed.
- The notes field should be a brief observation about THIS specific drawing, or "" if nothing notable.`

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

type Provider = "nvidia" | "cloudflare" | "gemini"
const CHAIN: Provider[] = ["cloudflare", "gemini", "nvidia"]

type ProviderResult = {
  ok: boolean
  raw?: string
  /** Recoverable error → caller should try the next provider in the chain. */
  recoverable: boolean
  error?: string
  keyIndex?: number
}

function collectKeys(prefix: string): string[] {
  return [
    Deno.env.get(prefix),
    Deno.env.get(`${prefix}_1`),
    Deno.env.get(`${prefix}_2`),
    Deno.env.get(`${prefix}_3`),
  ]
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .filter((k, i, arr) => arr.indexOf(k) === i)
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim()
}

/** Attempt to parse `raw` as JSON. If a model wrapped the JSON in
 *  prose ("Here is the result: { ... }"), extract the first balanced
 *  object substring and try again. Returns `null` on total failure.
 *  Returns the canonical JSON string so callers can re-emit a clean
 *  payload to the client. */
function tryParseJson(raw: string): { parsed: unknown; canonical: string } | null {
  if (!raw || typeof raw !== "string") return null
  const direct = raw.trim()
  // Fast path — the prompt asks for raw JSON, this should almost always hit.
  try {
    const parsed = JSON.parse(direct)
    return { parsed, canonical: JSON.stringify(parsed) }
  } catch { /* fall through */ }
  // Fallback — find the outermost `{ ... }` block by brace-balancing,
  // skipping braces inside string literals. Survives "Here is your JSON: { ... }"
  // and trailing prose. Returns the first valid block found.
  const start = direct.indexOf("{")
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < direct.length; i++) {
    const ch = direct[i]
    if (escape) { escape = false; continue }
    if (ch === "\\") { escape = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        const candidate = direct.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate)
          return { parsed, canonical: JSON.stringify(parsed) }
        } catch { return null }
      }
    }
  }
  return null
}

/** Minimal shape check — the schema we asked the model for has these
 *  array fields. If any is missing/wrong-typed, treat the response as
 *  invalid so the chain falls through to the next provider. */
function validateSchema(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.widths) && Array.isArray(o.heights)
}

function safeMime(mime: string): string {
  if (mime === "image/jpg") return "image/jpeg"
  return mime || "image/png"
}

type ImageInput = { imageBase64: string; mimeType: string }

async function callGemini(
  images: ImageInput[],
): Promise<ProviderResult> {
  const apiKeys = collectKeys("GEMINI_API_KEY")
  if (apiKeys.length === 0) {
    return { ok: false, recoverable: true, error: "no GEMINI_API_KEY" }
  }

  const prompt = (images.length > 1 ? multiPagePreamble(images.length) : "") + PROMPT
  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          ...images.map((img) => ({
            inlineData: { mimeType: safeMime(img.mimeType), data: img.imageBase64 },
          })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  })

  let lastError = "All Gemini API keys exhausted"
  for (let i = 0; i < apiKeys.length; i++) {
    let res: Response
    try {
      res = await fetch(`${GEMINI_API}?key=${apiKeys[i]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
    } catch (e) {
      return {
        ok: false,
        recoverable: true,
        error: `Network error calling Gemini: ${(e as Error).message}`,
      }
    }

    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
      return { ok: true, recoverable: false, raw: stripFences(text), keyIndex: i }
    }

    const errBody = await res.json().catch(() => ({}))
    const msg =
      (errBody as { error?: { message?: string } }).error?.message ??
      res.statusText
    const isRateLimit = res.status === 429 || /quota|rate/i.test(msg)

    if (isRateLimit && i < apiKeys.length - 1) {
      lastError = `quota: ${msg}`
      continue
    }
    return {
      ok: false,
      recoverable: isRateLimit,
      error: `${isRateLimit ? "quota" : "Gemini API"}: ${msg}`,
    }
  }

  return { ok: false, recoverable: true, error: lastError }
}

async function callNvidia(
  images: ImageInput[],
): Promise<ProviderResult> {
  const apiKeys = collectKeys("NVIDIA_API_KEY")
  if (apiKeys.length === 0) {
    return { ok: false, recoverable: true, error: "no NVIDIA_API_KEY" }
  }

  const prompt = (images.length > 1 ? multiPagePreamble(images.length) : "") + PROMPT
  const payload = JSON.stringify({
    model: NVIDIA_MODEL,
    max_tokens: 8192,
    temperature: 0.1,
    top_p: 0.9,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${safeMime(img.mimeType)};base64,${img.imageBase64}` },
          })),
        ],
      },
    ],
  })

  return callOpenAIShape("nvidia", NVIDIA_API, apiKeys, payload)
}

async function callCloudflare(
  images: ImageInput[],
): Promise<ProviderResult> {
  const apiKeys = collectKeys("CLOUDFLARE_API_KEY")
  if (apiKeys.length === 0) {
    return { ok: false, recoverable: true, error: "no CLOUDFLARE_API_KEY" }
  }

  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")
  if (!accountId) {
    return {
      ok: false,
      recoverable: true,
      error: "no CLOUDFLARE_ACCOUNT_ID configured on server",
    }
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CLOUDFLARE_MODEL}`

  const prompt = (images.length > 1 ? multiPagePreamble(images.length) : "") + PROMPT
  const payload = JSON.stringify({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${safeMime(img.mimeType)};base64,${img.imageBase64}` },
          })),
        ],
      },
    ],
    max_tokens: 8192,
    temperature: 0.1,
  })

  let lastError = "All Cloudflare API keys exhausted"
  for (let i = 0; i < apiKeys.length; i++) {
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKeys[i]}`,
        },
        body: payload,
      })
    } catch (e) {
      return {
        ok: false,
        recoverable: true,
        error: `Network error calling Cloudflare: ${(e as Error).message}`,
      }
    }

    if (res.ok) {
      // CF can return either its native shape `{ result: { response } }`
      // (legacy / completion models like Llama 3.2 Vision) or the
      // OpenAI chat shape `{ result: { choices: [{ message: { content } }] } }`
      // (chat models like Gemma 4). Try both before giving up.
      const data = (await res.json()) as {
        result?: {
          response?: string
          choices?: Array<{ message?: { content?: string } }>
        }
        success?: boolean
        errors?: Array<{ message?: string }>
      }
      if (data.success === false) {
        const msg = data.errors?.[0]?.message ?? "Cloudflare returned success=false"
        return {
          ok: false,
          recoverable: /quota|rate|credit|exceed|capacity|neuron|limit/i.test(msg),
          error: `Cloudflare API: ${msg}`,
        }
      }
      const raw =
        data.result?.response ?? data.result?.choices?.[0]?.message?.content
      const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "")
      return {
        ok: true,
        recoverable: false,
        raw: stripFences(text),
        keyIndex: i,
      }
    }

    const errText = await res.text().catch(() => "")
    let msg = res.statusText
    try {
      const parsed = JSON.parse(errText) as {
        errors?: Array<{ message?: string }>
        error?: string
        message?: string
      }
      if (Array.isArray(parsed.errors) && parsed.errors[0]?.message) {
        msg = parsed.errors[0].message
      } else if (typeof parsed.error === "string") msg = parsed.error
      else if (typeof parsed.message === "string") msg = parsed.message
    } catch {
      if (errText) msg = errText
    }

    const isRateLimit =
      res.status === 429 ||
      res.status === 402 ||
      res.status === 529 ||
      /quota|rate|credit|exceed|capacity|neuron|limit/i.test(msg)

    if (isRateLimit && i < apiKeys.length - 1) {
      lastError = `quota: ${msg}`
      continue
    }
    return {
      ok: false,
      recoverable: isRateLimit,
      error: `${isRateLimit ? "quota" : "Cloudflare API"}: ${msg}`,
    }
  }

  return { ok: false, recoverable: true, error: lastError }
}

async function callOpenAIShape(
  providerName: string,
  endpoint: string,
  apiKeys: string[],
  payload: string,
): Promise<ProviderResult> {
  let lastError = `All ${providerName} API keys exhausted`
  for (let i = 0; i < apiKeys.length; i++) {
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKeys[i]}`,
          Accept: "application/json",
        },
        body: payload,
      })
    } catch (e) {
      return {
        ok: false,
        recoverable: true,
        error: `Network error calling ${providerName}: ${(e as Error).message}`,
      }
    }

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = data.choices?.[0]?.message?.content ?? ""
      return {
        ok: true,
        recoverable: false,
        raw: stripFences(text),
        keyIndex: i,
      }
    }

    const errText = await res.text().catch(() => "")
    let msg = res.statusText
    try {
      const parsed = JSON.parse(errText) as {
        error?: { message?: string } | string
        detail?: string
        message?: string
        errors?: Array<{ message?: string }>
      }
      if (typeof parsed.error === "string") msg = parsed.error
      else if (typeof parsed.error?.message === "string") msg = parsed.error.message
      else if (typeof parsed.detail === "string") msg = parsed.detail
      else if (typeof parsed.message === "string") msg = parsed.message
      else if (Array.isArray(parsed.errors) && parsed.errors[0]?.message) {
        // Cloudflare-style { errors: [{ message: "..." }] }
        msg = parsed.errors[0].message
      }
    } catch {
      if (errText) msg = errText
    }

    const isRateLimit =
      res.status === 429 ||
      res.status === 402 || // payment required (credit depleted)
      res.status === 529 || // overloaded
      /quota|rate|credit|exceed|capacity|neuron|limit/i.test(msg)

    if (isRateLimit && i < apiKeys.length - 1) {
      lastError = `quota: ${msg}`
      continue
    }
    return {
      ok: false,
      recoverable: isRateLimit,
      error: `${isRateLimit ? "quota" : `${providerName} API`}: ${msg}`,
    }
  }

  return { ok: false, recoverable: true, error: lastError }
}

async function callProviderRaw(
  p: Provider,
  images: ImageInput[],
): Promise<ProviderResult> {
  switch (p) {
    case "gemini":
      return callGemini(images)
    case "nvidia":
      return callNvidia(images)
    case "cloudflare":
      return callCloudflare(images)
  }
}

/** Wraps the raw provider call with JSON parse + schema validation.
 *  If the model returned non-JSON or a shape we can't use, demote the
 *  result to a recoverable failure so the chain tries the next provider. */
async function callProvider(
  p: Provider,
  images: ImageInput[],
): Promise<ProviderResult> {
  const result = await callProviderRaw(p, images)
  if (!result.ok) return result
  const parsed = tryParseJson(result.raw ?? "")
  if (!parsed) {
    return {
      ok: false,
      recoverable: true,
      error: `${p}: response was not valid JSON`,
      keyIndex: result.keyIndex,
    }
  }
  if (!validateSchema(parsed.parsed)) {
    return {
      ok: false,
      recoverable: true,
      error: `${p}: response missing required fields (widths/heights)`,
      keyIndex: result.keyIndex,
    }
  }
  // Return canonical (re-stringified) JSON so the client always sees a
  // clean payload regardless of which provider answered.
  return { ...result, raw: parsed.canonical }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" })
  }

  let body: {
    imageBase64?: string
    mimeType?: string
    images?: ImageInput[]
    provider?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON body" })
  }

  // Accept both legacy single-image shape and new multi-image shape.
  const images: ImageInput[] =
    Array.isArray(body.images) && body.images.length > 0
      ? body.images
      : body.imageBase64 && body.mimeType
        ? [{ imageBase64: body.imageBase64, mimeType: body.mimeType }]
        : []

  if (images.length === 0) {
    return json({ error: "images (or imageBase64 + mimeType) are required" })
  }

  const totalSize = images.reduce((s, img) => s + img.imageBase64.length, 0)
  if (totalSize > 30 * 1024 * 1024) {
    return json({ error: "Images too large (max 30 MB total)" })
  }

  // Build the chain. A forced provider runs alone (no fallback).
  // Otherwise run the full cloudflare → gemini → nvidia chain.
  let chain: Provider[]
  if (
    body.provider === "nvidia" ||
    body.provider === "cloudflare" ||
    body.provider === "gemini"
  ) {
    chain = [body.provider]
  } else {
    chain = CHAIN
  }

  console.log(
    JSON.stringify({
      tag: "extract-drawing.start",
      requestedProvider: body.provider ?? "(auto)",
      chain,
      pageCount: images.length,
      env: {
        NVIDIA_API_KEY: !!Deno.env.get("NVIDIA_API_KEY"),
        CLOUDFLARE_API_KEY: !!Deno.env.get("CLOUDFLARE_API_KEY"),
        CLOUDFLARE_ACCOUNT_ID: !!Deno.env.get("CLOUDFLARE_ACCOUNT_ID"),
        GEMINI_API_KEY: !!Deno.env.get("GEMINI_API_KEY"),
      },
      totalBytesBase64: totalSize,
    }),
  )

  const trail: string[] = []
  for (const p of chain) {
    console.log(JSON.stringify({ tag: "extract-drawing.try", provider: p }))
    const result = await callProvider(p, images)
    console.log(
      JSON.stringify({
        tag: "extract-drawing.result",
        provider: p,
        ok: result.ok,
        recoverable: result.recoverable,
        keyIndex: result.keyIndex,
        error: result.error,
      }),
    )
    if (result.ok) {
      return json({
        raw: result.raw,
        provider: p,
        keyIndex: result.keyIndex,
        trail: trail.length > 0 ? trail : undefined,
      })
    }
    trail.push(`${p}: ${result.error}`)
    if (!result.recoverable) {
      console.log(
        JSON.stringify({
          tag: "extract-drawing.hard-fail",
          provider: p,
          trail,
        }),
      )
      return json({ error: result.error, provider: p, trail })
    }
  }

  console.log(
    JSON.stringify({ tag: "extract-drawing.exhausted", trail }),
  )
  return json({
    error: `All providers failed: ${trail.join(" | ")}`,
    trail,
  })
})
