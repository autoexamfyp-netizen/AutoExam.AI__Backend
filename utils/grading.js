"use strict"

/**
 * Auto-grading utilities.
 *
 * For MCQs we can grade automatically — compare the student's chosen option
 * against the question's `model_answer` (which our Gemini validator coerces
 * into one of the option strings). Short / Essay questions return null so a
 * teacher reviews them in the Submissions page.
 */

function normalize(s) {
  return String(s || "").trim().toLowerCase()
}

/**
 * Grade a single answer.
 * @param {object} question  question_bank row with question_type/marks/options/model_answer
 * @param {{ answer_text?: string, selected_option?: string }} answer
 * @returns {{ marks_obtained: number|null, is_correct: boolean|null }}
 */
function gradeAnswer(question, answer) {
  if (!question) return { marks_obtained: 0, is_correct: false }

  const max = Number(question.marks) || 0
  const type = question.question_type

  if (type === "mcq") {
    const chosen = normalize(answer?.selected_option)
    if (!chosen) return { marks_obtained: 0, is_correct: false }
    const correct = normalize(question.model_answer)
    const ok = chosen === correct
    return { marks_obtained: ok ? max : 0, is_correct: ok }
  }

  // Short / essay → manual grading; we still record the response.
  return { marks_obtained: null, is_correct: null }
}

module.exports = { gradeAnswer }
