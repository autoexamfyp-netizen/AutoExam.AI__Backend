"use strict"

const { teacherId, teacherPublishedExamIds } = require("../utils/teacherScope")

/**
 * Dashboard summary endpoint.
 *
 *   GET /api/dashboard/teacher
 *
 * Returns:
 *   {
 *     stats: { totalMaterials, totalTextMaterials, totalQuestions, totalAiQuestions,
 *              totalExams, pendingEvaluations, totalStudents },
 *     activity: [...],
 *     analytics: { byType, byDifficulty }
 *   }
 *
 * NOTE: "Total Students" and "Pending Evaluations" depend on tables that aren't
 * part of this MVP yet (`students`, `submissions`). They return 0 gracefully if
 * the tables don't exist; the schema can grow into them later.
 */

async function teacherSummary(req, res) {
  try {
    const uid = teacherId(req)
    const sb = req.supabase
    const pubIds = await teacherPublishedExamIds(sb, uid)

    const scopeMaterials = (q) => q.eq("uploaded_by", uid)
    const scopeText = (q) => q.eq("created_by", uid)
    const scopeQuestions = (q) => q.eq("created_by", uid)
    const scopeExams = (q) => q.eq("created_by", uid)
    const scopePublished = (q) => q.eq("published_by", uid)
    const scopeSubs = (q) => {
      if (!pubIds.length) return q.eq("published_exam_id", "00000000-0000-0000-0000-000000000000")
      return q.in("published_exam_id", pubIds)
    }

    const safeCount = async (table, build = (q) => q) => {
      try {
        const { count, error } = await build(sb.from(table).select("*", { count: "exact", head: true }))
        if (error) return 0
        return count || 0
      } catch {
        return 0
      }
    }

    const [
      totalMaterials,
      totalTextMaterials,
      totalQuestions,
      totalAiQuestions,
      totalExams,
      totalPublishedExams,
      totalExamSubmissions,
      pendingEvaluations,
      totalStudents,
    ] = await Promise.all([
      safeCount("materials", scopeMaterials),
      safeCount("text_materials", scopeText),
      safeCount("question_bank", (q) => scopeQuestions(q).eq("in_bank", true)),
      safeCount("question_bank", (q) => scopeQuestions(q).eq("in_bank", true).eq("ai_generated", true)),
      safeCount("exams", scopeExams),
      safeCount("published_exams", scopePublished),
      pubIds.length ? safeCount("exam_submissions", scopeSubs) : Promise.resolve(0),
      pubIds.length
        ? safeCount("exam_submissions", (q) => scopeSubs(q).in("status", ["submitted", "late"]))
        : Promise.resolve(0),
      Promise.resolve(0),
    ])

    const now = Date.now()
    let activePublishedExams = 0
    try {
      const { data: pubs } = await scopePublished(
        sb.from("published_exams").select("start_time,end_time,is_active"),
      )
        .eq("is_active", true)
        .limit(500)
      for (const p of pubs || []) {
        const a = new Date(p.start_time).getTime()
        const b = new Date(p.end_time).getTime()
        if (now >= a && now <= b) activePublishedExams += 1
      }
    } catch {
      activePublishedExams = 0
    }

    let studentsAttempted = 0
    try {
      if (pubIds.length) {
        const { data: subsAttempt, error: saErr } = await scopeSubs(sb.from("exam_submissions").select("student_id"))
        if (!saErr && subsAttempt?.length) {
          studentsAttempted = new Set(subsAttempt.map((r) => r.student_id).filter(Boolean)).size
        }
      }
    } catch {
      studentsAttempted = 0
    }

    // Recent activity — pull a small slice from each source, mash, sort.
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()

    const recentSubsQuery =
      pubIds.length > 0
        ? scopeSubs(
            sb
              .from("exam_submissions")
              .select("id,status,submitted_at,published_exam:published_exam_id(title)")
              .gte("submitted_at", since)
              .order("submitted_at", { ascending: false })
              .limit(6),
          )
        : Promise.resolve({ data: [] })

    const [recentMaterials, recentText, recentQuestions, recentExams, recentPublished, recentSubs] = await Promise.all([
      scopeMaterials(sb.from("materials").select("id,title,created_at"))
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(6),
      scopeText(sb.from("text_materials").select("id,title,created_at"))
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(6),
      scopeQuestions(
        sb.from("question_bank").select("id,prompt,question_type,ai_generated,created_at"),
      )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(6),
      scopeExams(sb.from("exams").select("id,title,total_marks,created_at"))
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(6),
      scopePublished(sb.from("published_exams").select("id,title,created_at"))
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(6),
      recentSubsQuery,
    ])

    const activity = []
    for (const r of recentMaterials.data || []) {
      activity.push({ id: `m-${r.id}`, type: "material", title: r.title, detail: "Uploaded a new material", when: r.created_at })
    }
    for (const r of recentText.data || []) {
      activity.push({ id: `t-${r.id}`, type: "text", title: r.title || "Untitled note", detail: "Saved text content", when: r.created_at })
    }
    for (const r of recentQuestions.data || []) {
      activity.push({
        id: `q-${r.id}`,
        type: "question",
        title: (r.prompt || "Question").slice(0, 80),
        detail: r.ai_generated ? "AI-generated question" : "Manually added question",
        when: r.created_at,
      })
    }
    for (const r of recentExams.data || []) {
      activity.push({ id: `e-${r.id}`, type: "exam", title: r.title, detail: `Exam created (${r.total_marks} marks)`, when: r.created_at })
    }
    for (const r of recentPublished.data || []) {
      activity.push({ id: `pub-${r.id}`, type: "publish", title: r.title, detail: "Exam published to students", when: r.created_at })
    }
    for (const r of recentSubs.data || []) {
      activity.push({
        id: `sub-${r.id}`,
        type: "submission",
        title: r.published_exam?.title || "Submission",
        detail: `Student submission · ${r.status}`,
        when: r.submitted_at || since,
      })
    }
    activity.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())

    // Analytics — aggregate question_bank by type / difficulty / topic.
    const allQ = await scopeQuestions(
      sb.from("question_bank").select("question_type,difficulty,ai_generated,created_at"),
    )
      .order("created_at", { ascending: false })
      .limit(500)

    const byType = { mcq: 0, short: 0, essay: 0 }
    const byDifficulty = { easy: 0, medium: 0, hard: 0 }
    for (const q of allQ.data || []) {
      if (q.question_type in byType) byType[q.question_type]++
      if (q.difficulty in byDifficulty) byDifficulty[q.difficulty]++
    }

    return res.json({
      ok: true,
      stats: {
        totalMaterials: totalMaterials + totalTextMaterials,
        totalUploads: totalMaterials,
        totalTextMaterials,
        totalQuestions,
        totalAiQuestions,
        totalExams,
        totalPublishedExams,
        activePublishedExams,
        totalExamSubmissions,
        pendingEvaluations,
        totalStudents,
        studentsAttempted,
      },
      activity: activity.slice(0, 10),
      analytics: {
        byType: [
          { name: "MCQ", value: byType.mcq },
          { name: "Short", value: byType.short },
          { name: "Essay", value: byType.essay },
        ],
        byDifficulty: [
          { name: "Easy", value: byDifficulty.easy },
          { name: "Medium", value: byDifficulty.medium },
          { name: "Hard", value: byDifficulty.hard },
        ],
      },
    })
  } catch (err) {
    console.error("❌ teacherSummary crash:", err)
    return res.status(500).json({ error: err?.message || "Dashboard failed" })
  }
}

function deriveStudentStatus(nowMs, published, submission) {
  const start = new Date(published.start_time).getTime()
  const end = new Date(published.end_time).getTime()
  if (submission) {
    if (submission.status === "submitted" || submission.status === "evaluated" || submission.status === "late") {
      return "completed"
    }
    if (submission.status === "in_progress") {
      return nowMs > end ? "missed" : "in_progress"
    }
  }
  if (nowMs < start) return "upcoming"
  if (nowMs > end) return "missed"
  return "active"
}

async function studentSummary(req, res) {
  try {
    console.log("📥 Fetching student dashboard data...")
    const sb = req.supabase
    const now = Date.now()

    const [pubRes, subRes] = await Promise.all([
      sb
        .from("published_exams")
        .select("id,title,start_time,end_time,duration_minutes,total_marks,total_questions,category:categories(id,title)")
        .eq("is_active", true)
        .order("start_time", { ascending: false })
        .limit(300),
      sb
        .from("exam_submissions")
        .select(
          "id,published_exam_id,status,total_score,max_score,teacher_remarks,submitted_at,started_at,updated_at,published_exam:published_exam_id(id,title,start_time,end_time,duration_minutes,total_marks,total_questions,category:categories(id,title))",
        )
        .eq("student_id", req.user.id)
        .order("updated_at", { ascending: false })
        .limit(300),
    ])

    if (pubRes.error) return res.status(500).json({ error: pubRes.error.message })
    if (subRes.error) return res.status(500).json({ error: subRes.error.message })

    const mergedByExam = new Map()
    for (const p of pubRes.data || []) mergedByExam.set(p.id, p)
    for (const s of subRes.data || []) {
      if (s.published_exam?.id) mergedByExam.set(s.published_exam.id, s.published_exam)
    }
    const publishedRows = Array.from(mergedByExam.values())
    const subByPub = new Map((subRes.data || []).map((s) => [s.published_exam_id, s]))

    console.log("📈 Calculating exam statuses")
    const exams = publishedRows.map((p) => {
      const sub = subByPub.get(p.id) || null
      const start = new Date(p.start_time).getTime()
      const end = new Date(p.end_time).getTime()
      const windowStatus = now < start ? "upcoming" : now > end ? "expired" : "active"
      const status = deriveStudentStatus(now, p, sub)
      console.log("✅ Status updated:", status)
      return { published: p, submission: sub, studentStatus: status, windowStatus }
    })

    const attempted = exams.filter((e) => e.submission != null)
    const completed = exams.filter((e) => e.studentStatus === "completed")
    const pending = exams.filter(
      (e) => e.studentStatus === "active" || e.studentStatus === "upcoming" || e.studentStatus === "in_progress",
    )
    const activeExams = exams
      .filter((e) => e.studentStatus === "active" || e.studentStatus === "upcoming" || e.studentStatus === "in_progress")
      .slice(0, 4)

    const completedWithScore = completed
      .filter((e) => e.submission && e.submission.total_score != null && Number(e.submission.max_score || 0) > 0)
      .sort((a, b) => {
        const ta = new Date(a.submission.submitted_at || a.submission.updated_at).getTime()
        const tb = new Date(b.submission.submitted_at || b.submission.updated_at).getTime()
        return tb - ta
      })
    const latest = completedWithScore[0]
    const latestScore = latest
      ? Math.round((Number(latest.submission.total_score || 0) / Number(latest.submission.max_score || 1)) * 100)
      : 0

    const overallAverage =
      completedWithScore.length > 0
        ? Math.round(
            completedWithScore.reduce((s, e) => {
              return s + (Number(e.submission.total_score || 0) / Math.max(1, Number(e.submission.max_score || 1))) * 100
            }, 0) / completedWithScore.length,
          )
        : 0

    const recentPerformances = completedWithScore.slice(0, 5).map((e) => ({
      id: e.submission.id,
      examTitle: e.published.title,
      score: Number(e.submission.total_score || 0),
      maxScore: Number(e.submission.max_score || 0),
      date: e.submission.submitted_at || e.submission.updated_at,
    }))

    const trend = completedWithScore
      .slice(0, 6)
      .reverse()
      .map((e) => ({
        label: new Date(e.submission.submitted_at || e.submission.updated_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        score: Math.round((Number(e.submission.total_score || 0) / Math.max(1, Number(e.submission.max_score || 1))) * 100),
      }))

    const notifications = [
      ...activeExams
        .filter((e) => e.studentStatus === "active")
        .slice(0, 2)
        .map((e) => ({
          id: `open-${e.published.id}`,
          tone: "info",
          title: `${e.published.title} is active`,
          body: "You can start this exam now.",
          when: "Now",
        })),
      ...completedWithScore.slice(0, 2).map((e) => ({
        id: `result-${e.submission.id}`,
        tone: "success",
        title: `Result updated: ${e.published.title}`,
        body: `Score ${Number(e.submission.total_score || 0)}/${Number(e.submission.max_score || 0)}`,
        when: new Date(e.submission.submitted_at || e.submission.updated_at).toLocaleString(),
      })),
    ].slice(0, 4)

    const payload = {
      ok: true,
      stats: {
        overallAverage,
        examsAttempted: attempted.length,
        pendingExams: pending.length,
        lastScore: latestScore,
        completedExams: completed.length,
        missedExams: exams.filter((e) => e.studentStatus === "missed").length,
      },
      trend,
      recentPerformances,
      activeExams,
      notifications,
      exams,
    }

    console.log("✅ Dashboard data loaded")
    return res.json(payload)
  } catch (error) {
    console.error("❌ Dashboard sync issue:", error)
    return res.status(500).json({ error: error?.message || "Student dashboard failed" })
  }
}

module.exports = { teacherSummary, studentSummary }
