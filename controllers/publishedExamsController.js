"use strict"

const SELECT_FULL =
  "*, category:categories(id,title), exam:generated_exam_id(id,title,total_questions,total_marks,duration_minutes)"

async function listPublished(req, res) {
  try {
    const { activeOnly } = req.query
    let q = req.supabase
      .from("published_exams")
      .select(SELECT_FULL)
      .order("start_time", { ascending: false })
      .limit(200)
    if (activeOnly === "true") q = q.eq("is_active", true)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, published: data || [] })
  } catch (e) {
    console.error("❌ listPublished:", e)
    return res.status(500).json({ error: e?.message || "List failed" })
  }
}

async function createPublished(req, res) {
  try {
    const {
      examId,
      title,
      description,
      categoryId,
      startTime,
      endTime,
      durationMinutes,
      allowOneAttempt = true,
      shuffleQuestions = false,
      autoSubmitOnTimeout = true,
      showResultsImmediately = false,
    } = req.body || {}

    if (!examId) return res.status(400).json({ error: "examId required" })
    if (!startTime || !endTime) return res.status(400).json({ error: "startTime and endTime required (ISO strings)" })

    const start = new Date(startTime)
    const end = new Date(endTime)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: "Invalid date format" })
    }
    if (end <= start) return res.status(400).json({ error: "endTime must be after startTime" })

    console.log("📄 Publishing exam...", { examId })
    console.log("⏰ Setting exam schedule", { start: start.toISOString(), end: end.toISOString() })

    const ex = await req.supabase
      .from("exams")
      .select("id,title,description,category_id,total_questions,total_marks,duration_minutes")
      .eq("id", examId)
      .single()
    if (ex.error || !ex.data) return res.status(404).json({ error: "Exam not found" })

    const e = ex.data
    const row = {
      generated_exam_id: e.id,
      title: (title || e.title || "Published exam").trim(),
      description: description ?? e.description ?? null,
      category_id: categoryId ?? e.category_id ?? null,
      published_by: req.user.id,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_minutes: Number(durationMinutes || e.duration_minutes) || 60,
      total_questions: e.total_questions ?? 0,
      total_marks: e.total_marks ?? 0,
      is_active: true,
      allow_one_attempt: !!allowOneAttempt,
      shuffle_questions: !!shuffleQuestions,
      auto_submit_on_timeout: !!autoSubmitOnTimeout,
      show_results_immediately: !!showResultsImmediately,
    }

    const ins = await req.supabase.from("published_exams").insert(row).select(SELECT_FULL).single()
    if (ins.error) {
      console.error("❌ publish insert:", ins.error)
      return res.status(500).json({ error: ins.error.message })
    }

    console.log("✅ Exam published successfully:", ins.data?.id)
    return res.json({ ok: true, published: ins.data })
  } catch (e) {
    console.error("❌ createPublished:", e)
    return res.status(500).json({ error: e?.message || "Publish failed" })
  }
}

async function updatePublished(req, res) {
  try {
    const { id } = req.params
    const allowed = [
      "title",
      "description",
      "category_id",
      "start_time",
      "end_time",
      "duration_minutes",
      "is_active",
      "allow_one_attempt",
      "shuffle_questions",
      "auto_submit_on_timeout",
      "show_results_immediately",
    ]
    const patch = {}
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k]
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no patchable fields" })
    patch.updated_at = new Date().toISOString()

    const { data, error } = await req.supabase
      .from("published_exams")
      .update(patch)
      .eq("id", id)
      .select(SELECT_FULL)
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, published: data })
  } catch (e) {
    console.error("❌ updatePublished:", e)
    return res.status(500).json({ error: e?.message || "Update failed" })
  }
}

async function deletePublished(req, res) {
  try {
    const { id } = req.params
    const { error } = await req.supabase.from("published_exams").delete().eq("id", id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  } catch (e) {
    console.error("❌ deletePublished:", e)
    return res.status(500).json({ error: e?.message || "Delete failed" })
  }
}

/** Count submissions per published exam (for teacher cards). */
async function submissionCounts(req, res) {
  try {
    const { data: mine, error: e1 } = await req.supabase
      .from("published_exams")
      .select("id")
      .eq("published_by", req.user.id)
    if (e1) return res.status(500).json({ error: e1.message })
    const ids = (mine || []).map((r) => r.id)
    if (!ids.length) return res.json({ ok: true, counts: {} })

    const { data: subs, error: e2 } = await req.supabase
      .from("exam_submissions")
      .select("published_exam_id,status")
      .in("published_exam_id", ids)
    if (e2) return res.status(500).json({ error: e2.message })

    const counts = {}
    for (const s of subs || []) {
      counts[s.published_exam_id] = counts[s.published_exam_id] || { total: 0, submitted: 0 }
      counts[s.published_exam_id].total += 1
      if (s.status === "submitted" || s.status === "evaluated" || s.status === "late") {
        counts[s.published_exam_id].submitted += 1
      }
    }
    return res.json({ ok: true, counts })
  } catch (e) {
    console.error("❌ submissionCounts:", e)
    return res.status(500).json({ error: e?.message || "Counts failed" })
  }
}

module.exports = {
  listPublished,
  createPublished,
  updatePublished,
  deletePublished,
  submissionCounts,
}
