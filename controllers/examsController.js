"use strict"

/**
 * Exam endpoints (manual + AI-composed exams share these).
 *
 *   GET    /api/exams                 → list (filterable)
 *   GET    /api/exams/grouped         → { byCategory: { "category-id": Exam[] } }
 *   POST   /api/exams                 → create exam from explicit question IDs
 *   GET    /api/exams/:id             → fetch exam + ordered questions
 *   PATCH  /api/exams/:id             → edit metadata or status
 *   POST   /api/exams/:id/duplicate   → clone exam + its question links
 *   DELETE /api/exams/:id             → remove
 */

// PostgREST embeds:
//   - `category:categories(id,title)` joins via the unique categories FK
//   - `source:text_materials!source_material_id(id,title)` disambiguates the FK
//     so PostgREST knows which relationship to follow
const SELECT_FULL =
  "*, category:categories(id,title), source:text_materials!source_material_id(id,title)"

async function listExams(req, res) {
  try {
    const { categoryId, status, materialId, limit = 100 } = req.query
    let q = req.supabase
      .from("exams")
      .select(SELECT_FULL)
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(limit) || 100, 500))
    if (categoryId === "__uncategorized__") q = q.is("category_id", null)
    else if (categoryId) q = q.eq("category_id", categoryId)
    if (status) q = q.eq("status", status)
    if (materialId) q = q.eq("source_material_id", materialId)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, exams: data || [] })
  } catch (err) {
    console.error("❌ listExams crash:", err)
    return res.status(500).json({ error: err?.message || "List failed" })
  }
}

/**
 * Group exams by category for the Question Bank's subject-wise view.
 * Returns:
 *   {
 *     groups: [
 *       { id: 'cat-id'|null, title: 'Web Development'|'Uncategorized', exams: [...] }
 *     ]
 *   }
 */
async function listExamsGrouped(req, res) {
  try {
    const { data, error } = await req.supabase
      .from("exams")
      .select(SELECT_FULL)
      .order("created_at", { ascending: false })
      .limit(500)
    if (error) return res.status(500).json({ error: error.message })

    const map = new Map()
    for (const e of data || []) {
      const key = e.category_id || "__uncategorized__"
      if (!map.has(key)) {
        map.set(key, {
          id: e.category_id || null,
          title: e.category?.title || "Uncategorized",
          exams: [],
        })
      }
      map.get(key).exams.push(e)
    }
    const groups = Array.from(map.values()).sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    )
    return res.json({ ok: true, groups })
  } catch (err) {
    console.error("❌ listExamsGrouped crash:", err)
    return res.status(500).json({ error: err?.message || "Group failed" })
  }
}

async function createExam(req, res) {
  try {
    const {
      title,
      description = null,
      durationMinutes = 60,
      categoryId = null,
      sourceMaterialId = null,
      questionIds = [],
    } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ error: "title required" })
    if (!Array.isArray(questionIds) || !questionIds.length) {
      return res.status(400).json({ error: "questionIds required" })
    }

    const qRes = await req.supabase
      .from("question_bank")
      .select("id, marks, difficulty")
      .in("id", questionIds)
    if (qRes.error) return res.status(500).json({ error: qRes.error.message })
    const totalMarks = (qRes.data || []).reduce((s, r) => s + (Number(r.marks) || 0), 0)
    const diffSet = new Set((qRes.data || []).map((r) => r.difficulty || "medium"))
    const difficulty = diffSet.size > 1 ? "mixed" : Array.from(diffSet)[0] || "medium"

    const eRes = await req.supabase
      .from("exams")
      .insert({
        title: title.trim(),
        description,
        category_id: categoryId,
        source_material_id: sourceMaterialId,
        duration_minutes: Number(durationMinutes) || 60,
        total_marks: totalMarks,
        difficulty,
        status: "draft",
        created_by: req.user.id,
      })
      .select(SELECT_FULL)
      .single()
    if (eRes.error) return res.status(500).json({ error: eRes.error.message })

    const exam = eRes.data
    const links = questionIds.map((qid, i) => ({ exam_id: exam.id, question_id: qid, position: i }))
    const lRes = await req.supabase.from("exam_questions").insert(links)
    if (lRes.error) {
      await req.supabase.from("exams").delete().eq("id", exam.id)
      return res.status(500).json({ error: lRes.error.message })
    }
    return res.json({ ok: true, exam })
  } catch (err) {
    console.error("❌ createExam crash:", err)
    return res.status(500).json({ error: err?.message || "Create failed" })
  }
}

async function getExam(req, res) {
  try {
    const { id } = req.params
    if (!id) return res.status(400).json({ ok: false, error: "exam id required" })

    // Try the rich embed first; fall back to a simpler select if the DB
    // schema is missing the optional source_material_id FK (older installs).
    let eRes = await req.supabase
      .from("exams")
      .select(SELECT_FULL)
      .eq("id", id)
      .maybeSingle()
    if (eRes.error) {
      console.warn("⚠️ getExam: SELECT_FULL failed, retrying without source FK:", eRes.error.message)
      eRes = await req.supabase
        .from("exams")
        .select("*, category:categories(id,title)")
        .eq("id", id)
        .maybeSingle()
    }
    if (eRes.error) {
      console.error("❌ getExam: select failed:", eRes.error)
      return res.status(500).json({ ok: false, error: eRes.error.message })
    }
    if (!eRes.data) {
      console.warn("⚠️ getExam: no row for id:", id, "user:", req.user?.id)
      return res
        .status(404)
        .json({ ok: false, error: "Exam not found or you do not have access to it." })
    }

    const linkRes = await req.supabase
      .from("exam_questions")
      .select("position, question:question_bank(*, category:categories(id,title))")
      .eq("exam_id", id)
      .order("position", { ascending: true })

    let questions = []
    if (linkRes.error) {
      console.warn("⚠️ getExam: questions load failed:", linkRes.error.message)
    } else {
      questions = (linkRes.data || [])
        .filter((r) => r.question) // drop orphans
        .map((r) => ({ ...r.question, position: r.position }))
    }

    console.log("📄 getExam ok:", { id, questions: questions.length, owner: eRes.data.created_by })
    return res.json({ ok: true, exam: eRes.data, questions })
  } catch (err) {
    console.error("❌ getExam crash:", err)
    return res.status(500).json({ ok: false, error: err?.message || "Fetch failed" })
  }
}

async function updateExam(req, res) {
  try {
    const { id } = req.params
    const allowed = [
      "title",
      "description",
      "duration_minutes",
      "total_marks",
      "status",
      "category_id",
      "difficulty",
      "source_material_id",
    ]
    const patch = {}
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k]
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no patchable fields" })
    patch.updated_at = new Date().toISOString()
    const { data, error } = await req.supabase
      .from("exams")
      .update(patch)
      .eq("id", id)
      .select(SELECT_FULL)
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, exam: data })
  } catch (err) {
    console.error("❌ updateExam crash:", err)
    return res.status(500).json({ error: err?.message || "Update failed" })
  }
}

async function deleteExam(req, res) {
  try {
    const { id } = req.params
    const { error } = await req.supabase.from("exams").delete().eq("id", id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  } catch (err) {
    console.error("❌ deleteExam crash:", err)
    return res.status(500).json({ error: err?.message || "Delete failed" })
  }
}

/**
 * Duplicate an exam: copy the metadata + the same `exam_questions` links.
 * Useful for spinning a new attempt of the same paper.
 */
async function duplicateExam(req, res) {
  try {
    const { id } = req.params
    const { title } = req.body || {}

    const srcRes = await req.supabase
      .from("exams")
      .select("*")
      .eq("id", id)
      .single()
    if (srcRes.error) return res.status(404).json({ error: srcRes.error.message })
    const src = srcRes.data

    const linksRes = await req.supabase
      .from("exam_questions")
      .select("question_id, position")
      .eq("exam_id", id)
      .order("position", { ascending: true })
    if (linksRes.error) return res.status(500).json({ error: linksRes.error.message })

    const newExamRes = await req.supabase
      .from("exams")
      .insert({
        title: (title || `${src.title} (copy)`).trim(),
        description: src.description,
        category_id: src.category_id,
        source_material_id: src.source_material_id,
        duration_minutes: src.duration_minutes,
        total_marks: src.total_marks,
        difficulty: src.difficulty,
        status: "draft",
        created_by: req.user.id,
      })
      .select(SELECT_FULL)
      .single()
    if (newExamRes.error) return res.status(500).json({ error: newExamRes.error.message })
    const newExam = newExamRes.data

    if (linksRes.data?.length) {
      const newLinks = linksRes.data.map((r, i) => ({
        exam_id: newExam.id,
        question_id: r.question_id,
        position: i,
      }))
      const linkIns = await req.supabase.from("exam_questions").insert(newLinks)
      if (linkIns.error) {
        await req.supabase.from("exams").delete().eq("id", newExam.id)
        return res.status(500).json({ error: linkIns.error.message })
      }
    }

    return res.json({ ok: true, exam: newExam })
  } catch (err) {
    console.error("❌ duplicateExam crash:", err)
    return res.status(500).json({ error: err?.message || "Duplicate failed" })
  }
}

module.exports = {
  listExams,
  listExamsGrouped,
  createExam,
  getExam,
  updateExam,
  deleteExam,
  duplicateExam,
}
