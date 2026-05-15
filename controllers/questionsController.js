"use strict"

/**
 * Question bank CRUD endpoints.
 *
 *   GET  /api/questions          → list (filterable)
 *   POST /api/questions/save     → bulk insert (for edited AI questions)
 *   PATCH /api/questions/:id     → edit prompt/answer/options/difficulty/etc
 *   DELETE /api/questions/:id    → remove
 */

const SELECT = "*, category:categories(id,title)"

async function listQuestions(req, res) {
  try {
    const {
      categoryId,
      questionType,
      difficulty,
      favorite,
      aiGenerated,
      search,
      limit = 200,
    } = req.query

    let q = req.supabase
      .from("question_bank")
      .select(SELECT)
      .eq("created_by", req.user.id)
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(limit) || 200, 500))

    if (categoryId === "__uncategorized__") q = q.is("category_id", null)
    else if (categoryId) q = q.eq("category_id", categoryId)
    if (questionType) q = q.eq("question_type", questionType)
    if (difficulty) q = q.eq("difficulty", difficulty)
    if (typeof favorite !== "undefined") q = q.eq("favorite", favorite === "true")
    if (typeof aiGenerated !== "undefined") q = q.eq("ai_generated", aiGenerated === "true")
    if (search && String(search).trim()) {
      q = q.ilike("prompt", `%${String(search).trim()}%`)
    }

    const { data, error } = await q
    if (error) {
      console.error("❌ listQuestions error:", error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true, questions: data || [] })
  } catch (err) {
    console.error("❌ listQuestions crash:", err)
    return res.status(500).json({ error: err?.message || "List failed" })
  }
}

async function saveQuestions(req, res) {
  try {
    const list = Array.isArray(req.body?.questions) ? req.body.questions : []
    if (!list.length) return res.status(400).json({ error: "questions array required" })

    const rows = list
      .map((q) => ({
        prompt: String(q.prompt || q.question_text || "").trim(),
        model_answer: q.model_answer ?? q.correct_answer ?? null,
        question_type: q.question_type || "short",
        options: Array.isArray(q.options) ? q.options : null,
        difficulty: q.difficulty || "medium",
        marks: Number(q.marks) || 2,
        topic: q.topic || null,
        ai_generated: !!q.ai_generated,
        favorite: !!q.favorite,
        category_id: q.category_id || null,
        text_material_id: q.text_material_id || null,
        created_by: req.user.id,
      }))
      .filter((r) => r.prompt)

    if (!rows.length) return res.status(400).json({ error: "No valid rows to save." })

    const { data, error } = await req.supabase.from("question_bank").insert(rows).select(SELECT)
    if (error) {
      console.error("❌ saveQuestions error:", error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true, saved: data || [] })
  } catch (err) {
    console.error("❌ saveQuestions crash:", err)
    return res.status(500).json({ error: err?.message || "Save failed" })
  }
}

const PATCHABLE = new Set([
  "prompt",
  "model_answer",
  "question_type",
  "options",
  "difficulty",
  "marks",
  "topic",
  "favorite",
  "category_id",
])

async function updateQuestion(req, res) {
  try {
    const { id } = req.params
    if (!id) return res.status(400).json({ error: "id required" })
    const patch = {}
    for (const [k, v] of Object.entries(req.body || {})) {
      if (PATCHABLE.has(k)) patch[k] = v
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no patchable fields" })

    const { data, error } = await req.supabase
      .from("question_bank")
      .update(patch)
      .eq("id", id)
      .eq("created_by", req.user.id)
      .select(SELECT)
      .single()
    if (error) {
      console.error("❌ updateQuestion error:", error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true, question: data })
  } catch (err) {
    console.error("❌ updateQuestion crash:", err)
    return res.status(500).json({ error: err?.message || "Update failed" })
  }
}

async function deleteQuestion(req, res) {
  try {
    const { id } = req.params
    if (!id) return res.status(400).json({ error: "id required" })
    const { error } = await req.supabase
      .from("question_bank")
      .delete()
      .eq("id", id)
      .eq("created_by", req.user.id)
    if (error) {
      console.error("❌ deleteQuestion error:", error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true })
  } catch (err) {
    console.error("❌ deleteQuestion crash:", err)
    return res.status(500).json({ error: err?.message || "Delete failed" })
  }
}

module.exports = { listQuestions, saveQuestions, updateQuestion, deleteQuestion }
