"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const { listSubmissions, getSubmission, gradeSubmissionTeacher } = require("../controllers/submissionsController")

router.get("/", requireAuth, listSubmissions)
router.get("/:id", requireAuth, getSubmission)
router.patch("/:id/grade", requireAuth, gradeSubmissionTeacher)

module.exports = router
