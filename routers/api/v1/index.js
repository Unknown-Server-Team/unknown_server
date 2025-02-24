const express = require('express');
const router = express.Router();
const { RatelimitManager } = require('../../../managers/RatelimitManager');
const authRouter = require('./auth');
const usersRouter = require('./users');

// Apply rate limiting to all API routes
router.use(RatelimitManager.createApiLimiter());

// Auth routes
router.use('/auth', authRouter);

// Users routes
router.use('/users', usersRouter);

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API health status
 *     description: Returns the current health status and performance metrics of the API
 *     responses:
 *       200:
 *         description: Health check information
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: 'v1',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;