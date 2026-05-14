"use strict"

/**
 * AutoExam.ai backend
 * -------------------
 * Express 5 + Supabase JWT-pass-through + Gemini 1.5 Flash.
 *
 * Endpoints:
 *   GET  /health
 *   POST /api/ai/generate-questions
 *   POST /api/ai/generate-exam
 *   GET  /api/questions
 *   POST /api/questions/save
 *   PATCH /api/questions/:id
 *   DELETE /api/questions/:id
 *   GET  /api/exams
 *   POST /api/exams
 *   GET  /api/exams/:id
 *   PATCH /api/exams/:id
 *   DELETE /api/exams/:id
 *   GET  /api/dashboard/teacher
 */

const express = require("express")
const cors = require("cors")

const config = require("./config")
const aiRoutes = require("./routes/aiRoutes")
const questionsRoutes = require("./routes/questionsRoutes")
const examsRoutes = require("./routes/examsRoutes")
const dashboardRoutes = require("./routes/dashboardRoutes")
const publishedExamsRoutes = require("./routes/publishedExamsRoutes")
const studentExamRoutes = require("./routes/studentExamRoutes")
const submissionsRoutes = require("./routes/submissionsRoutes")

const app = express()

// Allow either configured origin OR any localhost dev port (Vite picks 5173/5174/etc).
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true)
      if (origin === config.frontendOrigin) return cb(null, true)
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true)
      return cb(null, true) // dev-friendly default; tighten for prod
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: "1mb" }))

// API responses are user-specific and frequently change. Disable HTTP caching
// to avoid Chromium's `net::ERR_CACHE_READ_FAILURE` (a corrupt disk-cache
// entry returning an empty 200) and to keep dashboards in sync after edits.
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  res.set("Pragma", "no-cache")
  res.set("Expires", "0")
  next()
})

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "autoexam-backend",
    geminiConfigured: !!config.gemini.apiKey,
    model: config.gemini.model,
  }),
)

app.use("/api/ai", aiRoutes)
app.use("/api/questions", questionsRoutes)
app.use("/api/exams", examsRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/published-exams", publishedExamsRoutes)
app.use("/api/student", studentExamRoutes)
app.use("/api/submissions", submissionsRoutes)

// Catch-all error handler
app.use((err, _req, res, _next) => {
  console.error("❌ unhandled error:", err)
  res.status(500).json({ error: err?.message || "Server error" })
})

app.listen(config.port, () => {
  console.log(`🚀 AutoExam backend listening on http://localhost:${config.port}`)
  console.log(`   Frontend origin: ${config.frontendOrigin}`)
  console.log(`   Gemini configured: ${config.gemini.apiKey ? "yes" : "NO — set GEMINI_API_KEY in Backend/.env"}`)
})
