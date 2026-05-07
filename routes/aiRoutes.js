"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const { generateQuestions, generateExam } = require("../controllers/aiController")

router.post("/generate-questions", requireAuth, generateQuestions)
router.post("/generate-exam", requireAuth, generateExam)

module.exports = router
