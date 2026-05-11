"use strict"

/**
 * AI controller.
 *
 * Endpoints:
 *   POST /api/ai/generate-questions  → Gemini → validated questions (optionally saved)
 *   POST /api/ai/generate-exam       → Gemini composes exam from question_bank, saved
 */

const { callGemini, safeParseJson } = require("../services/geminiService")
const { buildQuestionPrompt, buildExamCompositionPrompt } = require("../utils/promptBuilder")
const { normalizeQuestions } = require("../utils/validateQuestions")

const DEFAULT_CONFIG = {
  mcq: 5,
  short: 3,
  essay: 1,
  difficulty: "medium",
  marksMcq: 2,
  marksShort: 4,
  marksEssay: 10,
}

async function generateQuestions(req, res) {
  const started = Date.now()
  try {
    const {
      content,
      title,
      categoryTitle,
      categoryId = null,
      textMaterialId = null,
      config = {},
      save = true,
    } = req.body || {}

    if (!content || typeof content !== "string" || content.trim().length < 30) {
      return res.status(400).json({ error: "Content is required (min ~30 characters)." })
    }

    const merged = { ...DEFAULT_CONFIG, ...config }
    const total = (merged.mcq || 0) + (merged.short || 0) + (merged.essay || 0)
    if (total <= 0) {
      return res.status(400).json({ error: "Pick at least one question to generate." })
    }
    if (total > 30) {
      return res.status(400).json({ error: "Please request 30 or fewer questions per call." })
    }

    console.log("📚 Generating questions from text content", {
      user: req.user?.id,
      contentChars: content.length,
      config: merged,
    })

    const prompt = buildQuestionPrompt({ content, title, categoryTitle, config: merged })
    const { text } = await callGemini(prompt)
    console.log("🧠 Parsing AI-generated questions")
    const parsed = safeParseJson(text)
    const questions = normalizeQuestions(parsed, { defaultDifficulty: merged.difficulty })

    if (questions.length === 0) {
      return res.status(502).json({ error: "Gemini returned no usable questions. Try again." })
    }

    let saved = []
    if (save) {
      const rows = questions.map((q) => ({
        ...q,
        created_by: req.user.id,
        category_id: categoryId || null,
        text_material_id: textMaterialId || null,
      }))
      console.log("💾 Saving generated questions", { count: rows.length })
      const { data, error } = await req.supabase.from("question_bank").insert(rows).select("*")
      if (error) {
        console.error("❌ Supabase insert error:", error)
        return res.status(500).json({ error: error.message, generated: questions })
      }
      saved = data || []
    }

    return res.json({
      ok: true,
      generated: questions,
      saved,
      took_ms: Date.now() - started,
    })
  } catch (err) {
    console.error("❌ generateQuestions failed:", err)
    return res.status(500).json({ error: err?.message || "Question generation failed" })
  }
}

async function generateExam(req, res) {
  const started = Date.now()
  try {
    const {
      title = "AI-composed exam",
      description = "",
      categoryId = null,
      sourceMaterialId = null,
      durationMinutes = 60,
      mode = "from-bank", // 'from-bank' | 'from-content' | 'from-material'
      content,
      examConfig = {},
      sourceQuestionIds = null,
    } = req.body || {}

    const cfg = {
      targetMcq: Number(examConfig.targetMcq ?? 5),
      targetShort: Number(examConfig.targetShort ?? 3),
      targetEssay: Number(examConfig.targetEssay ?? 1),
      difficulty: examConfig.difficulty || "mixed",
      title,
    }

    let questionRows = []
    let resolvedSourceMaterialId = sourceMaterialId
    let resolvedContent = content
    let resolvedTitle = title
    let resolvedCategoryId = categoryId
    let resolvedCategoryTitle = examConfig.categoryTitle

    // If the teacher picked a saved text material, hydrate its content and
    // category server-side so the FE doesn't need to re-send it.
    if ((mode === "from-content" || mode === "from-material") && sourceMaterialId) {
      const matRes = await req.supabase
        .from("text_materials")
        .select("id, title, content, category_id, category:categories(id,title)")
        .eq("id", sourceMaterialId)
        .single()
      if (matRes.error || !matRes.data) {
        return res.status(404).json({ error: "Selected content not found." })
      }
      resolvedContent = matRes.data.content || ""
      resolvedSourceMaterialId = matRes.data.id
      if (!resolvedCategoryId) resolvedCategoryId = matRes.data.category_id
      if (!resolvedCategoryTitle) resolvedCategoryTitle = matRes.data.category?.title
      if (!resolvedTitle || resolvedTitle === "AI-composed exam") {
        resolvedTitle = `${matRes.data.title || "Untitled"} — Exam`
      }
    }

    const fromContentMode = mode === "from-content" || mode === "from-material"

    if (fromContentMode) {
      if (!resolvedContent || resolvedContent.trim().length < 30) {
        return res.status(400).json({ error: "Source content must be at least 30 characters." })
      }
      const prompt = buildQuestionPrompt({
        content: resolvedContent,
        title: resolvedTitle,
        categoryTitle: resolvedCategoryTitle,
        config: {
          mcq: cfg.targetMcq,
          short: cfg.targetShort,
          essay: cfg.targetEssay,
          difficulty: cfg.difficulty === "mixed" ? "medium" : cfg.difficulty,
          marksMcq: 2,
          marksShort: 4,
          marksEssay: 10,
        },
      })
      const { text } = await callGemini(prompt)
      const parsed = safeParseJson(text)
      const questions = normalizeQuestions(parsed, { defaultDifficulty: "medium" })
      if (!questions.length) {
        return res.status(502).json({ error: "Gemini returned no usable questions for the exam." })
      }
      const rows = questions.map((q) => ({
        ...q,
        created_by: req.user.id,
        category_id: resolvedCategoryId || null,
        text_material_id: resolvedSourceMaterialId || null,
      }))
      const ins = await req.supabase.from("question_bank").insert(rows).select("*")
      if (ins.error) {
        console.error("❌ Supabase insert error (exam q):", ins.error)
        return res.status(500).json({ error: ins.error.message })
      }
      questionRows = ins.data || []
    } else {
      // Pull candidates from question_bank (RLS scopes to current user).
      let q = req.supabase
        .from("question_bank")
        .select("id, prompt, question_type, difficulty, marks, topic, options, model_answer")
        .order("created_at", { ascending: false })
        .limit(120)
      if (resolvedCategoryId) q = q.eq("category_id", resolvedCategoryId)
      if (Array.isArray(sourceQuestionIds) && sourceQuestionIds.length) {
        q = q.in("id", sourceQuestionIds)
      }
      const { data, error } = await q
      if (error) {
        console.error("❌ Supabase select error:", error)
        return res.status(500).json({ error: error.message })
      }
      const candidates = data || []
      if (!candidates.length) {
        return res
          .status(400)
          .json({ error: "No questions in your bank. Generate some questions first or paste content." })
      }

      const prompt = buildExamCompositionPrompt({ questions: candidates, examConfig: cfg })
      const { text } = await callGemini(prompt, { temperature: 0.4 })
      const parsed = safeParseJson(text)
      const ids = Array.isArray(parsed?.ordered_question_ids) ? parsed.ordered_question_ids : []
      const validIds = new Set(candidates.map((c) => c.id))
      const ordered = ids.filter((id) => validIds.has(id))

      // Fall back: if Gemini didn't pick enough, top up by simple type sort.
      const desired = cfg.targetMcq + cfg.targetShort + cfg.targetEssay
      if (ordered.length < desired) {
        const taken = new Set(ordered)
        const buckets = { mcq: [], short: [], essay: [] }
        for (const c of candidates) {
          if (taken.has(c.id)) continue
          ;(buckets[c.question_type] || buckets.short).push(c.id)
        }
        const need = (t, n) => buckets[t].splice(0, n)
        ordered.push(
          ...need("mcq", Math.max(0, cfg.targetMcq - countType(candidates, ordered, "mcq"))),
          ...need("short", Math.max(0, cfg.targetShort - countType(candidates, ordered, "short"))),
          ...need("essay", Math.max(0, cfg.targetEssay - countType(candidates, ordered, "essay"))),
        )
      }

      questionRows = ordered.map((id) => candidates.find((c) => c.id === id)).filter(Boolean)
      if (!questionRows.length) {
        return res.status(502).json({ error: "Could not compose an exam from the available questions." })
      }
    }

    const totalMarks = questionRows.reduce((sum, r) => sum + (Number(r.marks) || 0), 0)

    // Compute representative difficulty (most common in the chosen set).
    const diffCounts = {}
    for (const r of questionRows) {
      const k = r.difficulty || "medium"
      diffCounts[k] = (diffCounts[k] || 0) + 1
    }
    const sortedDiffs = Object.entries(diffCounts).sort((a, b) => b[1] - a[1])
    const distinct = Object.keys(diffCounts).length
    const representativeDifficulty = distinct > 1 ? "mixed" : sortedDiffs[0]?.[0] || "medium"

    const ins = await req.supabase
      .from("exams")
      .insert({
        created_by: req.user.id,
        category_id: resolvedCategoryId || null,
        source_material_id: resolvedSourceMaterialId || null,
        title: resolvedTitle,
        description: description || null,
        duration_minutes: Number(durationMinutes) || 60,
        total_marks: totalMarks,
        difficulty: representativeDifficulty,
        status: "draft",
      })
      .select("*")
      .single()
    if (ins.error) {
      console.error("❌ Supabase insert error (exam):", ins.error)
      return res.status(500).json({ error: ins.error.message })
    }
    const exam = ins.data

    const links = questionRows.map((q, i) => ({
      exam_id: exam.id,
      question_id: q.id,
      position: i,
    }))
    const linkRes = await req.supabase.from("exam_questions").insert(links)
    if (linkRes.error) {
      console.error("❌ Supabase insert error (exam_questions):", linkRes.error)
      // Best-effort cleanup
      await req.supabase.from("exams").delete().eq("id", exam.id)
      return res.status(500).json({ error: linkRes.error.message })
    }

    return res.json({
      ok: true,
      exam,
      questions: questionRows,
      took_ms: Date.now() - started,
    })
  } catch (err) {
    console.error("❌ generateExam failed:", err)
    return res.status(500).json({ error: err?.message || "Exam generation failed" })
  }
}

function countType(all, idList, type) {
  return idList.reduce((n, id) => n + (all.find((c) => c.id === id)?.question_type === type ? 1 : 0), 0)
}

module.exports = { generateQuestions, generateExam }
