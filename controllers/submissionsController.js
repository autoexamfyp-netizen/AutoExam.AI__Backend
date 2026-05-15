"use strict"

const { teacherId, teacherPublishedExamIds } = require("../utils/teacherScope")

/**
 * Teacher-facing submission review (RLS + explicit filter on teacher's published exams).
 */

async function listSubmissions(req, res) {
  try {
    console.log("📥 Loading submissions...")
    const uid = teacherId(req)
    const pubIds = await teacherPublishedExamIds(req.supabase, uid)
    if (!pubIds.length) {
      console.log("✅ Submissions loaded: 0")
      return res.json({ ok: true, submissions: [] })
    }

    const { publishedExamId, status } = req.query
    let q = req.supabase
      .from("exam_submissions")
      .select(
        "id,status,started_at,submitted_at,time_taken_seconds,total_score,max_score,student_id,published_exam:published_exam_id(id,title,start_time,end_time)",
      )
      .in("published_exam_id", pubIds)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(500)
    if (publishedExamId) {
      if (!pubIds.includes(publishedExamId)) {
        return res.json({ ok: true, submissions: [] })
      }
      q = q.eq("published_exam_id", publishedExamId)
    }
    if (status) q = q.eq("status", status)
    const { data, error } = await q
    if (error) {
      console.error("❌ listSubmissions:", error)
      return res.status(500).json({ error: error.message })
    }
    console.log("✅ Submissions loaded:", data?.length ?? 0)
    return res.json({ ok: true, submissions: data || [] })
  } catch (e) {
    console.error("❌ listSubmissions crash:", e)
    return res.status(500).json({ error: e?.message || "List failed" })
  }
}

async function getSubmission(req, res) {
  try {
    const uid = teacherId(req)
    const pubIds = await teacherPublishedExamIds(req.supabase, uid)
    if (!pubIds.length) return res.status(404).json({ error: "Submission not found" })

    const { id } = req.params
    const subRes = await req.supabase
      .from("exam_submissions")
      .select(
        "*, published_exam:published_exam_id(id,title,generated_exam_id,start_time,end_time,total_marks,duration_minutes)",
      )
      .eq("id", id)
      .in("published_exam_id", pubIds)
      .single()
    if (subRes.error) return res.status(404).json({ error: subRes.error.message })

    const ansRes = await req.supabase
      .from("submission_answers")
      .select("*, question:question_bank(id,prompt,question_type,topic,difficulty,options,model_answer,marks)")
      .eq("submission_id", id)
    if (ansRes.error) return res.status(500).json({ error: ansRes.error.message })

    console.log("✅ Submission loaded:", id)
    return res.json({ ok: true, submission: subRes.data, answers: ansRes.data || [] })
  } catch (e) {
    console.error("❌ getSubmission:", e)
    return res.status(500).json({ error: e?.message || "Fetch failed" })
  }
}

/**
 * PATCH /api/submissions/:id/grade
 * body: { teacherRemarks?: string, answers?: [{ questionId, marksObtained, evaluatorRemarks? }] }
 */
async function gradeSubmissionTeacher(req, res) {
  try {
    const uid = teacherId(req)
    const pubIds = await teacherPublishedExamIds(req.supabase, uid)
    if (!pubIds.length) return res.status(404).json({ error: "Submission not found" })

    const { id } = req.params
    const { teacherRemarks, answers = [] } = req.body || {}

    console.log("📝 Reviewing student answers", { submissionId: id })

    const subRes = await req.supabase
      .from("exam_submissions")
      .select("*")
      .eq("id", id)
      .in("published_exam_id", pubIds)
      .single()
    if (subRes.error) return res.status(404).json({ error: subRes.error.message })

    for (const a of answers) {
      if (!a.questionId) continue
      const patch = {
        marks_obtained: Number(a.marksObtained),
        updated_at: new Date().toISOString(),
      }
      if (typeof a.evaluatorRemarks === "string") patch.evaluator_remarks = a.evaluatorRemarks
      const u = await req.supabase
        .from("submission_answers")
        .update(patch)
        .eq("submission_id", id)
        .eq("question_id", a.questionId)
      if (u.error) console.warn("⚠️ answer patch:", u.error.message)
    }

    const all = await req.supabase
      .from("submission_answers")
      .select("marks_obtained")
      .eq("submission_id", id)
    if (all.error) return res.status(500).json({ error: all.error.message })
    const total = (all.data || []).reduce((s, r) => s + (Number(r.marks_obtained) || 0), 0)

    const fin = await req.supabase
      .from("exam_submissions")
      .update({
        total_score: total,
        status: "evaluated",
        teacher_remarks: teacherRemarks ?? subRes.data.teacher_remarks,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("published_exam_id", pubIds)
      .select("*")
      .single()
    if (fin.error) return res.status(500).json({ error: fin.error.message })

    console.log("✅ Grades saved", { total })
    return res.json({ ok: true, submission: fin.data })
  } catch (e) {
    console.error("❌ gradeSubmissionTeacher:", e)
    return res.status(500).json({ error: e?.message || "Grade failed" })
  }
}

module.exports = { listSubmissions, getSubmission, gradeSubmissionTeacher }
