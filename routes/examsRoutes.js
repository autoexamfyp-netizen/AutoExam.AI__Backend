"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const {
  listExams,
  listExamsGrouped,
  createExam,
  getExam,
  updateExam,
  deleteExam,
  duplicateExam,
} = require("../controllers/examsController")

router.get("/", requireAuth, listExams)
router.get("/grouped", requireAuth, listExamsGrouped)
router.post("/", requireAuth, createExam)
router.get("/:id", requireAuth, getExam)
router.patch("/:id", requireAuth, updateExam)
router.post("/:id/duplicate", requireAuth, duplicateExam)
router.delete("/:id", requireAuth, deleteExam)

module.exports = router
