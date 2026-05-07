"use strict"

/**
 * Verify the Supabase access token and attach a user-scoped Supabase client.
 *
 * - Reads `Authorization: Bearer <jwt>` from the incoming request.
 * - Uses the JWT to call `supabase.auth.getUser()`, which validates the
 *   signature against the project's anon key + JWT secret and returns the user.
 * - Attaches `req.user` and `req.supabase` for downstream handlers.
 */

const { clientFor } = require("../services/supabaseService")

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
    if (!token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token." })
    }

    const supabase = clientFor(token)
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid or expired session." })
    }

    req.user = data.user
    req.supabase = supabase
    return next()
  } catch (err) {
    console.error("❌ requireAuth crash:", err)
    return res.status(500).json({ error: "Auth check failed." })
  }
}

module.exports = { requireAuth }
