const express = require('express');
const router = express.Router();

// Import sub-routers
const docsRouter = require('./docs');
const { RatelimitManager } = require('../../managers/RatelimitManager');

router.use(RatelimitManager.createApiLimiter());

// Main routes
router.get('/', (req, res) => {
    res.render('index');
});

// Documentation routes
router.use('/docs', docsRouter);

module.exports = router;