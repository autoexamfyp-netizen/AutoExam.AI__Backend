"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const {
  listExams,
  createExam,
  getExam,
  updateExam,
  deleteExam,
} = require("../controllers/examsController")

router.get("/", requireAuth, listExams)
router.post("/", requireAuth, createExam)
router.get("/:id", requireAuth, getExam)
router.patch("/:id", requireAuth, updateExam)
router.delete("/:id", requireAuth, deleteExam)

module.exports = router
