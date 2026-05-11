"use strict"

const { gradeSubmission } = require("../utils/gradeSubmission")

function nowStatus(t0, start, end) {
  if (t0 < start) return "upcoming"
  if (t0 > end) return "expired"
  return "active"
}

function stripQuestionForStudent(q) {
  if (!q) return null
  const { model_answer, created_by, favorite, use_count, ai_generated, text_material_id, ...rest } = q
  return {
    id: rest.id,
    prompt: rest.prompt,
    question_type: rest.question_type,
    marks: rest.marks,
    topic: rest.topic,
    options: rest.options,
    position: rest.position,
  }
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

async function loadOrderedQuestions(sb, examId) {
  const { data, error } = await sb
    .from("exam_questions")
    .select("position, question:question_bank(*)")
    .eq("exam_id", examId)
    .order("position", { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map((r) => ({ ...r.question, position: r.position }))
}

/**
 * GET /api/student/exams
 */
async function listStudentExams(req, res) {
  try {
    console.log("📚 Fetching active exams...")
    const t0 = Date.now()
    const [pubRes, subRes] = await Promise.all([
      req.supabase
        .from("published_exams")
        .select("*, category:categories(id,title), exam:generated_exam_id(id,title,total_questions)")
        .eq("is_active", true)
        .order("start_time", { ascending: false })
        .limit(200),
      req.supabase
        .from("exam_submissions")
        .select(
          "id,published_exam_id,status,submitted_at,total_score,max_score,started_at, published_exam:published_exam_id(*, category:categories(id,title), exam:generated_exam_id(id,title,total_questions))",
        )
        .eq("student_id", req.user.id)
        .limit(200),
    ])
    if (pubRes.error) {
      console.error("❌ student exams list:", pubRes.error)
      return res.status(500).json({ error: pubRes.error.message })
    }
    if (subRes.error) {
      console.warn("⚠️ submissions fetch:", subRes.error.message)
    }

    const byPub = new Map()
    for (const p of pubRes.data || []) byPub.set(p.id, p)
    for (const s of subRes.data || []) {
      const pe = s.published_exam
      if (pe?.id) byPub.set(pe.id, pe)
    }

    const published = Array.from(byPub.values())
    const subByPub = new Map((subRes.data || []).map((s) => [s.published_exam_id, s]))

    const out = (published || []).map((p) => {
      const start = new Date(p.start_time).getTime()
      const end = new Date(p.end_time).getTime()
      const win = nowStatus(t0, start, end)
      const sub = subByPub.get(p.id)
      let studentState = win
      if (sub?.status === "submitted" || sub?.status === "evaluated") studentState = "completed"
      else if (sub?.status === "in_progress") studentState = win === "expired" ? "missed" : "in_progress"
      else if (sub?.status === "late") studentState = "completed"
      else if (win === "expired") studentState = "missed"

      return {
        published: p,
        windowStatus: win,
        studentStatus: studentState,
        submission: sub || null,
      }
    })

    console.log("✅ Active exams loaded:", out.length)
    return res.json({ ok: true, exams: out })
  } catch (e) {
    console.error("❌ listStudentExams:", e)
    return res.status(500).json({ error: e?.message || "List failed" })
  }
}

/**
 * POST /api/student/exams/:publishedId/start
 */
async function startAttempt(req, res) {
  try {
    const { publishedId } = req.params
    const t0 = Date.now()

    const pubRes = await req.supabase
      .from("published_exams")
      .select("*, exam:generated_exam_id(id)")
      .eq("id", publishedId)
      .eq("is_active", true)
      .single()
    if (pubRes.error || !pubRes.data) return res.status(404).json({ error: "Published exam not found" })
    const pub = pubRes.data
    const examId = pub.exam?.id || pub.generated_exam_id
    if (!examId) return res.status(400).json({ error: "Published exam has no linked exam template" })

    const start = new Date(pub.start_time).getTime()
    const end = new Date(pub.end_time).getTime()
    const win = nowStatus(t0, start, end)
    if (win === "upcoming") return res.status(403).json({ error: "This exam is not open yet." })
    if (win === "expired") return res.status(403).json({ error: "This exam has ended." })

    const existing = await req.supabase
      .from("exam_submissions")
      .select("*")
      .eq("published_exam_id", publishedId)
      .eq("student_id", req.user.id)
      .maybeSingle()

    if (existing.data) {
      const s = existing.data
      if (pub.allow_one_attempt && (s.status === "submitted" || s.status === "evaluated" || s.status === "late")) {
        return res.status(403).json({ error: "You have already submitted this exam." })
      }
      if (s.status !== "in_progress") {
        return res.status(403).json({ error: "No active attempt for this exam." })
      }
      console.log("🚀 Student resumed exam", { submissionId: s.id })
      let qs = await loadOrderedQuestions(req.supabase, examId)
      if (pub.shuffle_questions) shuffleInPlace(qs)
      return res.json({
        ok: true,
        submission: s,
        questions: qs.map(stripQuestionForStudent),
        published: pub,
      })
    }

    console.log("🚀 Student started exam", { publishedId })
    console.log("📝 Creating submission record")
    const totalSec = Math.max(60, (Number(pub.duration_minutes) || 60) * 60)
    const ins = await req.supabase
      .from("exam_submissions")
      .insert({
        published_exam_id: publishedId,
        student_id: req.user.id,
        status: "in_progress",
        max_score: Number(pub.total_marks) || 0,
        answers_data: {
          __meta: {
            totalSeconds: totalSec,
            secondsRemaining: totalSec,
            updatedAt: new Date().toISOString(),
          },
        },
      })
      .select("*")
      .single()

    if (ins.error) {
      if (ins.error.code === "23505") {
        const retry = await req.supabase
          .from("exam_submissions")
          .select("*")
          .eq("published_exam_id", publishedId)
          .eq("student_id", req.user.id)
          .single()
        if (!retry.error && retry.data) {
          let qs2 = await loadOrderedQuestions(req.supabase, examId)
          if (pub.shuffle_questions) shuffleInPlace(qs2)
          return res.json({
            ok: true,
            submission: retry.data,
            questions: qs2.map(stripQuestionForStudent),
            published: pub,
          })
        }
      }
      console.error("❌ start insert:", ins.error)
      return res.status(500).json({ error: ins.error.message })
    }

    let qs = await loadOrderedQuestions(req.supabase, examId)
    if (pub.shuffle_questions) shuffleInPlace(qs)

    console.log("⏱️ Timer initialized", { totalSec })
    return res.json({
      ok: true,
      submission: ins.data,
      questions: qs.map(stripQuestionForStudent),
      published: pub,
    })
  } catch (e) {
    console.error("❌ startAttempt:", e)
    return res.status(500).json({ error: e?.message || "Start failed" })
  }
}

/**
 * PATCH /api/student/submissions/:submissionId/draft
 * body: { answers?: { [qid]: { text?, selected? } }, secondsRemaining?: number }
 */
async function saveDraft(req, res) {
  try {
    const { submissionId } = req.params
    const { answers = {}, secondsRemaining } = req.body || {}

    const cur = await req.supabase
      .from("exam_submissions")
      .select("*, published_exam:published_exam_id(*)")
      .eq("id", submissionId)
      .eq("student_id", req.user.id)
      .single()
    if (cur.error || !cur.data) return res.status(404).json({ error: "Submission not found" })
    if (cur.data.status !== "in_progress") return res.status(400).json({ error: "Attempt is not editable" })

    const pub = cur.data.published_exam
    const end = new Date(pub.end_time).getTime()
    if (Date.now() > end) return res.status(403).json({ error: "Exam window has closed." })

    console.log("💾 Saving answer...")
    const prev = cur.data.answers_data || {}
    const meta = { ...(prev.__meta || {}) }
    if (typeof secondsRemaining === "number" && secondsRemaining >= 0) {
      meta.secondsRemaining = Math.floor(secondsRemaining)
    }
    meta.updatedAt = new Date().toISOString()
    const next = { ...prev, __meta: meta }
    for (const [k, v] of Object.entries(answers)) {
      if (k.startsWith("__")) continue
      next[k] = { ...(prev[k] || {}), ...v }
    }

    const upd = await req.supabase
      .from("exam_submissions")
      .update({
        answers_data: next,
        last_saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId)
      .select("*")
      .single()
    if (upd.error) {
      console.error("❌ Submission save failed:", upd.error)
      return res.status(500).json({ error: upd.error.message })
    }
    console.log("✅ Answers saved")
    return res.json({ ok: true, submission: upd.data })
  } catch (e) {
    console.error("❌ saveDraft:", e)
    return res.status(500).json({ error: e?.message || "Save failed" })
  }
}

/**
 * POST /api/student/submissions/:submissionId/submit
 * body: { secondsRemaining?: number }
 */
async function submitAttempt(req, res) {
  try {
    const { submissionId } = req.params
    const { secondsRemaining } = req.body || {}

    const cur = await req.supabase
      .from("exam_submissions")
      .select("*, published_exam:published_exam_id(*)")
      .eq("id", submissionId)
      .eq("student_id", req.user.id)
      .single()
    if (cur.error || !cur.data) return res.status(404).json({ error: "Submission not found" })
    if (cur.data.status !== "in_progress") return res.status(400).json({ error: "Already submitted" })

    const pub = cur.data.published_exam
    const examId = pub.generated_exam_id
    console.log("📤 Submitting exam...")
    const t0 = Date.now()
    const end = new Date(pub.end_time).getTime()
    const isLate = t0 > end

    const qs = await loadOrderedQuestions(req.supabase, examId)
    const answersMap = { ...(cur.data.answers_data || {}) }
    delete answersMap.__meta

    if (typeof secondsRemaining === "number") {
      answersMap.__tmpSec = secondsRemaining
    }

    const { rows, totalScore, maxScore } = gradeSubmission(qs, answersMap)
    delete answersMap.__tmpSec

    const meta = cur.data.answers_data?.__meta || {}
    const totalSec = meta.totalSeconds || (Number(pub.duration_minutes) || 60) * 60
    const rem =
      typeof secondsRemaining === "number"
        ? Math.max(0, Math.floor(secondsRemaining))
        : Math.max(0, Math.floor(meta.secondsRemaining ?? totalSec))
    const timeTaken = Math.min(totalSec, Math.max(0, totalSec - rem))

    const status = isLate ? "late" : "submitted"

    const insRows = rows.map((r) => ({
      submission_id: submissionId,
      ...r,
    }))
    const insAns = await req.supabase.from("submission_answers").insert(insRows)
    if (insAns.error) {
      console.error("❌ insert answers:", insAns.error)
      return res.status(500).json({ error: insAns.error.message })
    }

    const fin = await req.supabase
      .from("exam_submissions")
      .update({
        status,
        submitted_at: new Date().toISOString(),
        time_taken_seconds: timeTaken,
        total_score: totalScore,
        max_score: maxScore,
        answers_data: cur.data.answers_data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId)
      .select("*")
      .single()
    if (fin.error) return res.status(500).json({ error: fin.error.message })

    console.log("✅ Submission completed", { submissionId, status, totalScore })
    console.log("📊 Updating dashboard statistics")
    return res.json({ ok: true, submission: fin.data, scored: { totalScore, maxScore } })
  } catch (e) {
    console.error("❌ submitAttempt:", e)
    return res.status(500).json({ error: e?.message || "Submit failed" })
  }
}

module.exports = {
  listStudentExams,
  startAttempt,
  saveDraft,
  submitAttempt,
}
