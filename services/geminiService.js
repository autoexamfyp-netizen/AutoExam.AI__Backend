"use strict"

/**
 * Thin Gemini client.
 *
 * Uses the public REST endpoint so we don't have to ship the SDK; Node 18+
 * exposes `fetch` globally.
 *
 * Tip:
 *   - Get an API key at https://aistudio.google.com/app/apikey
 *   - Set GEMINI_API_KEY in Backend/.env
 *   - Default model is gemini-1.5-flash; override with GEMINI_MODEL.
 */

const config = require("../config")

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

/**
 * Fallback chain used when a 404 says the requested model alias has been
 * retired or renamed. We try the configured model first, then sweep the
 * well-known stable aliases for the Flash family.
 */
const FLASH_FALLBACKS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
]

let resolvedModel = null // cached after the first successful call

function buildModelChain(preferred) {
  const seen = new Set()
  const order = []
  for (const m of [preferred, ...FLASH_FALLBACKS]) {
    if (!m || seen.has(m)) continue
    seen.add(m)
    order.push(m)
  }
  return order
}

/**
 * Call Gemini and return the parsed JSON response body. JSON-mode is requested
 * via `responseMimeType: "application/json"` so the model is much less likely
 * to wrap output in code fences.
 *
 * If the API returns 404 with "is not found" / "is not supported", we walk
 * the fallback chain instead of erroring out — Google rotates aliases often.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {number} [opts.temperature]    default 0.7
 * @param {number} [opts.topP]           default 0.95
 * @param {number} [opts.maxOutputTokens] default 4096
 * @returns {Promise<{text: string, raw: object, model: string}>}
 */
async function callGemini(prompt, opts = {}) {
  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY missing in Backend/.env")
  }

  const chain = buildModelChain(resolvedModel || config.gemini.model)
  console.log("🤖 Calling Gemini API...", { tryOrder: chain, promptChars: prompt.length })

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: opts.temperature ?? 0.7,
      topP: opts.topP ?? 0.95,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  }

  let lastError
  for (const model of chain) {
    const url = `${ENDPOINT(model)}?key=${encodeURIComponent(config.gemini.apiKey)}`
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errBody = await res.text()
        const isModelMissing =
          res.status === 404 ||
          /is not found|not supported|model.*not.*available/i.test(errBody)

        if (isModelMissing && chain.length > 1) {
          console.warn(`⚠️ Model ${model} unavailable (${res.status}), trying next fallback...`)
          lastError = new Error(`${res.status}: ${errBody.slice(0, 200)}`)
          continue
        }

        console.error("❌ Gemini API Error:", res.status, errBody.slice(0, 500))
        throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 200)}`)
      }

      const data = await res.json()
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || ""
      if (resolvedModel !== model) {
        resolvedModel = model
        if (model !== config.gemini.model) {
          console.log(`✅ Locked Gemini model: ${model} (configured was ${config.gemini.model})`)
        }
      }
      console.log("✅ Gemini response received", { model, chars: text.length })
      return { text, raw: data, model }
    } catch (err) {
      lastError = err
      // Network errors fall through to the next model only if there is one.
      if (chain.indexOf(model) === chain.length - 1) throw err
      console.warn(`⚠️ Model ${model} failed, trying next fallback...`, err?.message)
    }
  }

  throw lastError || new Error("Gemini API: no model available")
}

/**
 * Robust JSON parsing for model output.
 *
 * Even with responseMimeType: application/json, models occasionally wrap
 * payloads in code fences or leak commentary. We sweep those out.
 */
function safeParseJson(text) {
  if (!text) return null
  let s = text.trim()
  // Strip ```json ... ``` fences if any
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "")
  // Find first '{' or '['
  const start = Math.min(
    ...["{", "["].map((c) => {
      const i = s.indexOf(c)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }),
  )
  if (start === Number.MAX_SAFE_INTEGER) return null
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"))
  if (end <= start) return null
  const candidate = s.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch (e) {
    console.warn("⚠️ Could not parse model JSON:", e?.message)
    return null
  }
}

module.exports = { callGemini, safeParseJson }
