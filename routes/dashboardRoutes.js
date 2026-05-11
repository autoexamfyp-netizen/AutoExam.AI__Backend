"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const { teacherSummary, studentSummary } = require("../controllers/dashboardController")

router.get("/teacher", requireAuth, teacherSummary)
router.get("/student", requireAuth, studentSummary)

module.exports = router
