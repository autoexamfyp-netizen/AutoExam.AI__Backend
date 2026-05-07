"use strict"

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
 *     analytics: { byType, byDifficulty, byTopic, examsTrend }
 *   }
 *
 * NOTE: "Total Students" and "Pending Evaluations" depend on tables that aren't
 * part of this MVP yet (`students`, `submissions`). They return 0 gracefully if
 * the tables don't exist; the schema can grow into them later.
 */

async function teacherSummary(req, res) {
  try {
    const sb = req.supabase

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
      pendingEvaluations,
      totalStudents,
    ] = await Promise.all([
      safeCount("materials"),
      safeCount("text_materials"),
      safeCount("question_bank"),
      safeCount("question_bank", (q) => q.eq("ai_generated", true)),
      safeCount("exams"),
      safeCount("submissions", (q) => q.eq("status", "pending")),
      safeCount("students"),
    ])

    // Recent activity — pull a small slice from each source, mash, sort.
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()

    const [recentMaterials, recentText, recentQuestions, recentExams] = await Promise.all([
      sb.from("materials").select("id,title,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(6),
      sb.from("text_materials").select("id,title,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(6),
      sb.from("question_bank").select("id,prompt,question_type,ai_generated,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(6),
      sb.from("exams").select("id,title,total_marks,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(6),
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
    activity.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())

    // Analytics — aggregate question_bank by type / difficulty / topic.
    const allQ = await sb
      .from("question_bank")
      .select("question_type,difficulty,topic,ai_generated,created_at")
      .order("created_at", { ascending: false })
      .limit(500)

    const byType = { mcq: 0, short: 0, essay: 0 }
    const byDifficulty = { easy: 0, medium: 0, hard: 0 }
    const byTopic = {}
    for (const q of allQ.data || []) {
      if (q.question_type in byType) byType[q.question_type]++
      if (q.difficulty in byDifficulty) byDifficulty[q.difficulty]++
      const t = (q.topic || "Uncategorized").trim()
      byTopic[t] = (byTopic[t] || 0) + 1
    }

    // Exams created per week — last 8 weeks.
    const examWeekBuckets = {}
    const allExams = await sb
      .from("exams")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(500)
    for (const e of allExams.data || []) {
      const d = new Date(e.created_at)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toISOString().slice(0, 10)
      examWeekBuckets[key] = (examWeekBuckets[key] || 0) + 1
    }
    const examsTrend = Object.entries(examWeekBuckets)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-8)
      .map(([weekStart, count]) => ({ label: weekStart.slice(5), count }))

    return res.json({
      ok: true,
      stats: {
        totalMaterials: totalMaterials + totalTextMaterials,
        totalUploads: totalMaterials,
        totalTextMaterials,
        totalQuestions,
        totalAiQuestions,
        totalExams,
        pendingEvaluations,
        totalStudents,
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
        byTopic: Object.entries(byTopic)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([name, value]) => ({ name, value })),
        examsTrend,
      },
    })
  } catch (err) {
    console.error("❌ teacherSummary crash:", err)
    return res.status(500).json({ error: err?.message || "Dashboard failed" })
  }
}

module.exports = { teacherSummary }
