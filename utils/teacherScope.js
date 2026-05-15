"use strict"

function teacherId(req) {
  const id = req.user?.id
  if (!id) {
    const err = new Error("Unauthorized")
    err.status = 401
    throw err
  }
  console.log("🔐 Current Teacher:", id)
  return id
}

/** Published exam ids owned by this teacher (for submission scoping). */
async function teacherPublishedExamIds(supabase, uid) {
  const { data, error } = await supabase.from("published_exams").select("id").eq("published_by", uid)
  if (error) throw error
  return (data || []).map((r) => r.id)
}

module.exports = { teacherId, teacherPublishedExamIds }
