"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const {
  listPublished,
  createPublished,
  updatePublished,
  deletePublished,
  submissionCounts,
} = require("../controllers/publishedExamsController")

router.get("/counts", requireAuth, submissionCounts)
router.get("/", requireAuth, listPublished)
router.post("/", requireAuth, createPublished)
router.patch("/:id", requireAuth, updatePublished)
router.delete("/:id", requireAuth, deletePublished)

module.exports = router
