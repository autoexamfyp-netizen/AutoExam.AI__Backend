"use strict"

/**
 * Validate and coerce AI-generated question objects so a single bad row from
 * the model can't poison a Supabase insert.
 *
 * Output rows match the `question_bank` schema:
 *   { prompt, model_answer, question_type, options, difficulty, marks, topic, ai_generated }
 */

const TYPES = new Set(["mcq", "short", "essay"])
const DIFFS = new Set(["easy", "medium", "hard"])

function trimStr(v, max) {
  if (typeof v !== "string") return ""
  const s = v.trim()
  return max && s.length > max ? s.slice(0, max) : s
}

/**
 * @param {any} raw  Output from Gemini (already JSON-parsed)
 * @param {{ defaultDifficulty?: string }} [opts]
 * @returns {Array<object>}
 */
function normalizeQuestions(raw, opts = {}) {
  const list = Array.isArray(raw?.questions) ? raw.questions : Array.isArray(raw) ? raw : []
  const out = []

  for (const q of list) {
    if (!q || typeof q !== "object") continue
    const type = TYPES.has(q.question_type) ? q.question_type : "short"
    const prompt = trimStr(q.question_text || q.prompt, 4000)
    if (!prompt) continue

    let options = null
    if (type === "mcq") {
      const arr = Array.isArray(q.options) ? q.options.map((o) => trimStr(o, 500)).filter(Boolean) : []
      // Keep first 4 unique options.
      const seen = new Set()
      const unique = []
      for (const o of arr) {
        const key = o.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          unique.push(o)
        }
        if (unique.length >= 4) break
      }
      if (unique.length < 4) continue
      options = unique.slice(0, 4)
    }

    let answer = trimStr(q.correct_answer || q.model_answer, 4000)
    if (type === "mcq" && options) {
      const matched = options.find((o) => o.toLowerCase() === answer.toLowerCase())
      answer = matched || options[0]
    }

    const difficulty = DIFFS.has(q.difficulty) ? q.difficulty : opts.defaultDifficulty || "medium"
    let marks = Number(q.marks)
    if (!Number.isFinite(marks) || marks <= 0) {
      marks = type === "essay" ? 10 : type === "short" ? 4 : 2
    }

    out.push({
      prompt,
      model_answer: answer || null,
      question_type: type,
      options,
      difficulty,
      marks,
      topic: trimStr(q.topic, 120) || null,
      ai_generated: true,
    })
  }

  return out
}

module.exports = { normalizeQuestions }
