const express = require('express');
const router = express.Router();

// Main route
router.get('/', (req, res) => {
    res.render('index');
});

module.exports = router;