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
