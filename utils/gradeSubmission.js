"use strict"

/**
 * Grade a student's answers against `question_bank` rows.
 * - MCQ: full marks if selected_option matches model_answer (case-insensitive trim).
 * - short / essay: 0 marks by default (teacher evaluates); answers preserved.
 *
 * @param {Array<{ id: string, question_type: string, marks: number, model_answer: string|null, options: any }>} questionsInOrder
 * @param {Record<string, { text?: string, selected?: string|null }>} answersMap  question_id → payload
 * @returns {{ rows: object[], totalScore: number, maxScore: number }}
 */
function gradeSubmission(questionsInOrder, answersMap) {
  let totalScore = 0
  let maxScore = 0
  const rows = []

  for (const q of questionsInOrder) {
    const max = Number(q.marks) || 0
    maxScore += max
    const ans = answersMap[q.id] || {}
    const text = typeof ans.text === "string" ? ans.text.trim() : ""
    const selected = ans.selected != null && ans.selected !== "" ? String(ans.selected).trim() : null

    let marks = 0
    let isCorrect = null
    let selectedOption = selected

    if (q.question_type === "mcq") {
      const key = (q.model_answer || "").trim()
      if (selected && key && selected.toLowerCase() === key.toLowerCase()) {
        marks = max
        isCorrect = true
      } else {
        isCorrect = false
      }
    } else {
      marks = 0
      isCorrect = null
      selectedOption = null
    }

    totalScore += marks
    rows.push({
      question_id: q.id,
      answer_text: text || null,
      selected_option: selectedOption,
      is_correct: isCorrect,
      marks_obtained: marks,
      max_marks: max,
    })
  }

  return { rows, totalScore, maxScore }
}

module.exports = { gradeSubmission }
