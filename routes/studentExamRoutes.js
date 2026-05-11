"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const {
  listStudentExams,
  startAttempt,
  saveDraft,
  submitAttempt,
} = require("../controllers/studentExamsController")

router.get("/exams", requireAuth, listStudentExams)
router.post("/exams/:publishedId/start", requireAuth, startAttempt)
router.patch("/submissions/:submissionId/draft", requireAuth, saveDraft)
router.post("/submissions/:submissionId/submit", requireAuth, submitAttempt)

module.exports = router
