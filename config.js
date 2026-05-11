"use strict"

require("dotenv").config()

const required = (name) => {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.warn(`⚠️  Missing env var: ${name}`)
    return ""
  }
  return v.trim()
}

const config = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  supabase: {
    url: required("SUPABASE_URL"),
    anonKey: required("SUPABASE_ANON_KEY"),
  },
  gemini: {
    apiKey: required("GEMINI_API_KEY"),
    // Default model — `gemini-flash-latest` is the current public alias for the
    // Flash family on v1beta. The service auto-falls back to a few well-known
    // aliases if Google retires/renames a model.
    model: process.env.GEMINI_MODEL || "gemini-flash-latest",
  },
}

module.exports = config
