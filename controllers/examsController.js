"use strict"

/**
 * Exam endpoints (manual + AI-composed exams share these).
 *
 *   GET    /api/exams              → list
 *   POST   /api/exams              → create exam from explicit question IDs
 *   GET    /api/exams/:id          → fetch exam + ordered questions
 *   PATCH  /api/exams/:id          → edit metadata or status
 *   DELETE /api/exams/:id          → remove
 */

async function listExams(req, res) {
  try {
    const { categoryId, status, limit = 100 } = req.query
    let q = req.supabase
      .from("exams")
      .select("*, category:categories(id,title)")
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(limit) || 100, 500))
    if (categoryId === "__uncategorized__") q = q.is("category_id", null)
    else if (categoryId) q = q.eq("category_id", categoryId)
    if (status) q = q.eq("status", status)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })

    // Question counts (best effort, single round trip).
    const ids = (data || []).map((e) => e.id)
    let counts = {}
    if (ids.length) {
      const cRes = await req.supabase
        .from("exam_questions")
        .select("exam_id", { count: "exact" })
        .in("exam_id", ids)
      // Note: PostgREST's count returns total across all matched, not grouped.
      // For per-exam counts, do a small additional query.
      if (!cRes.error) {
        const grouped = await req.supabase
          .from("exam_questions")
          .select("exam_id, id")
          .in("exam_id", ids)
        if (!grouped.error) {
          for (const row of grouped.data || []) {
            counts[row.exam_id] = (counts[row.exam_id] || 0) + 1
          }
        }
      }
    }
    const exams = (data || []).map((e) => ({ ...e, question_count: counts[e.id] || 0 }))
    return res.json({ ok: true, exams })
  } catch (err) {
    console.error("❌ listExams crash:", err)
    return res.status(500).json({ error: err?.message || "List failed" })
  }
}

async function createExam(req, res) {
  try {
    const {
      title,
      description = null,
      durationMinutes = 60,
      categoryId = null,
      questionIds = [],
    } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ error: "title required" })
    if (!Array.isArray(questionIds) || !questionIds.length) {
      return res.status(400).json({ error: "questionIds required" })
    }

    const qRes = await req.supabase
      .from("question_bank")
      .select("id, marks")
      .in("id", questionIds)
    if (qRes.error) return res.status(500).json({ error: qRes.error.message })
    const totalMarks = (qRes.data || []).reduce((s, r) => s + (Number(r.marks) || 0), 0)

    const eRes = await req.supabase
      .from("exams")
      .insert({
        title: title.trim(),
        description,
        category_id: categoryId,
        duration_minutes: Number(durationMinutes) || 60,
        total_marks: totalMarks,
        status: "draft",
        created_by: req.user.id,
      })
      .select("*")
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
    const eRes = await req.supabase
      .from("exams")
      .select("*, category:categories(id,title)")
      .eq("id", id)
      .single()
    if (eRes.error) return res.status(404).json({ error: eRes.error.message })

    const linkRes = await req.supabase
      .from("exam_questions")
      .select("position, question:question_bank(*)")
      .eq("exam_id", id)
      .order("position", { ascending: true })
    if (linkRes.error) return res.status(500).json({ error: linkRes.error.message })

    return res.json({
      ok: true,
      exam: eRes.data,
      questions: (linkRes.data || []).map((r) => ({ ...r.question, position: r.position })),
    })
  } catch (err) {
    console.error("❌ getExam crash:", err)
    return res.status(500).json({ error: err?.message || "Fetch failed" })
  }
}

async function updateExam(req, res) {
  try {
    const { id } = req.params
    const allowed = ["title", "description", "duration_minutes", "total_marks", "status", "category_id"]
    const patch = {}
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k]
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no patchable fields" })
    const { data, error } = await req.supabase
      .from("exams")
      .update(patch)
      .eq("id", id)
      .select("*")
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

module.exports = { listExams, createExam, getExam, updateExam, deleteExam }
