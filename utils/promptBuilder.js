"use strict"

/**
 * Prompts for Gemini.
 *
 * Hard constraints baked into every prompt:
 *  - Use the provided text content only — do not invent material outside it.
 *  - Return PURE JSON (no markdown fences, no commentary).
 *  - Schema is fixed; the JSON validator on the controller side rejects anything
 *    that doesn't match.
 */

const SYSTEM_RULES = `You are AutoExam.ai, an expert AI exam generation assistant for university teachers.

STRICT RULES:
1. Generate intelligent, academically relevant, non-repetitive questions.
2. Use ONLY the provided educational content. Do NOT invent facts that are not in the content.
3. Respond with PURE JSON ONLY — no prose, no markdown fences, no explanation.
4. Match the requested schema exactly. Use the same JSON keys as shown.
5. For MCQs, include exactly 4 distinct options. Distractors must be plausible but clearly wrong given the content.
6. The "correct_answer" for an MCQ must be one of the strings in "options".
7. For essay/short, "correct_answer" is a concise model answer (3–6 sentences for essay, 1–3 sentences for short).
8. "difficulty" must be one of "easy" | "medium" | "hard".
9. "marks" is a positive integer.
10. Keep all questions self-contained — never reference "the passage above" or "the figure".`

/**
 * @typedef {object} GenerationConfig
 * @property {number} mcq
 * @property {number} short
 * @property {number} essay
 * @property {'easy'|'medium'|'hard'} difficulty
 * @property {number} marksMcq
 * @property {number} marksShort
 * @property {number} marksEssay
 */

/**
 * Build a one-shot prompt that asks Gemini to return:
 *   { "questions": [ ... ] }
 *
 * @param {object} args
 * @param {string} args.content
 * @param {string} [args.title]
 * @param {string} [args.categoryTitle]
 * @param {GenerationConfig} args.config
 */
function buildQuestionPrompt({ content, title, categoryTitle, config }) {
  const safeTitle = (title || "Study material").slice(0, 200)
  const safeCat = (categoryTitle || "General").slice(0, 100)

  const schema = `{
  "questions": [
    {
      "question_text": "string",
      "question_type": "mcq" | "short" | "essay",
      "options": ["string","string","string","string"]   // exactly 4 for mcq, otherwise null
      "correct_answer": "string",
      "difficulty": "easy" | "medium" | "hard",
      "marks": number,
      "topic": "string"
    }
  ]
}`

  return [
    SYSTEM_RULES,
    "",
    `SUBJECT: ${safeCat}`,
    `TITLE: ${safeTitle}`,
    "",
    "REQUESTED MIX:",
    `- ${config.mcq ?? 0} multiple-choice questions (${config.marksMcq ?? 2} marks each)`,
    `- ${config.short ?? 0} short-answer questions (${config.marksShort ?? 4} marks each)`,
    `- ${config.essay ?? 0} essay questions (${config.marksEssay ?? 10} marks each)`,
    `- Target difficulty: ${config.difficulty || "medium"}`,
    "",
    "JSON SCHEMA (return EXACTLY this shape):",
    schema,
    "",
    "EDUCATIONAL CONTENT (source of truth; do not exceed it):",
    "<<<CONTENT>>>",
    content,
    "<<<END CONTENT>>>",
    "",
    "Return JSON only.",
  ].join("\n")
}

/**
 * Prompt for assembling a balanced exam from a list of question_bank rows.
 * The model returns a JSON list of question IDs in the order it recommends.
 *
 * @param {object} args
 * @param {Array<{id:string, prompt:string, question_type:string, difficulty:string, marks:number, topic?:string}>} args.questions
 * @param {object} args.examConfig
 * @param {number} args.examConfig.targetMcq
 * @param {number} args.examConfig.targetShort
 * @param {number} args.examConfig.targetEssay
 * @param {'easy'|'medium'|'hard'|'mixed'} [args.examConfig.difficulty]
 * @param {string} [args.examConfig.title]
 */
function buildExamCompositionPrompt({ questions, examConfig }) {
  const compact = questions.map((q) => ({
    id: q.id,
    type: q.question_type,
    difficulty: q.difficulty,
    marks: q.marks,
    topic: q.topic || null,
    prompt: String(q.prompt || "").slice(0, 240),
  }))

  return [
    SYSTEM_RULES,
    "",
    `Compose an exam titled: "${examConfig.title || "AI-composed exam"}".`,
    "Pick from the candidate questions below. Maximize topic coverage, avoid duplicates, balance difficulty.",
    `Target mix: ${examConfig.targetMcq} MCQ, ${examConfig.targetShort} short, ${examConfig.targetEssay} essay.`,
    `Overall difficulty preference: ${examConfig.difficulty || "mixed"}.`,
    "",
    "JSON SCHEMA (return EXACTLY this shape):",
    `{ "ordered_question_ids": ["uuid", "uuid", "..."] }`,
    "",
    "CANDIDATES:",
    JSON.stringify(compact, null, 2),
    "",
    "Return JSON only.",
  ].join("\n")
}

module.exports = { buildQuestionPrompt, buildExamCompositionPrompt }
