"use strict"

const router = require("express").Router()
const { requireAuth } = require("../middleware/auth")
const { teacherSummary } = require("../controllers/dashboardController")

router.get("/teacher", requireAuth, teacherSummary)

module.exports = router
