"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const {
  listQuestions,
  saveQuestions,
  updateQuestion,
  deleteQuestion,
} = require("../controllers/questionsController")

router.get("/", requireAuth, listQuestions)
router.post("/save", requireAuth, saveQuestions)
router.patch("/:id", requireAuth, updateQuestion)
router.delete("/:id", requireAuth, deleteQuestion)

module.exports = router
