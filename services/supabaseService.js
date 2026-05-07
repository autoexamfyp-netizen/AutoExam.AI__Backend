"use strict"

/**
 * Per-request Supabase client.
 *
 * The frontend forwards the Supabase access token (Authorization: Bearer <jwt>).
 * We construct a *new* client per request that wires that JWT into PostgREST so
 * Row-Level-Security policies on `categories`, `materials`, `text_materials`,
 * `question_bank`, `exams`, etc. still apply.
 *
 * No service-role key is used — keeps secrets minimal for the FYP.
 */

const { createClient } = require("@supabase/supabase-js")
const config = require("../config")

/**
 * @param {string} accessToken Supabase JWT extracted from the request.
 */
function clientFor(accessToken) {
  if (!config.supabase.url || !config.supabase.anonKey) {
    throw new Error("Supabase env vars missing on backend (SUPABASE_URL / SUPABASE_ANON_KEY)")
  }
  return createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })
}

module.exports = { clientFor }
