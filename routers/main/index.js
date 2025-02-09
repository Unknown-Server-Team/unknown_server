const express = require('express');
const router = express.Router();

// Main route
router.get('/', (req, res) => {
    res.render('index');
});

// 404 handler - should be the last route
router.use((req, res) => {
    res.status(404).render('404');
});

module.exports = router;