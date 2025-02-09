const express = require('express');
const router = express.Router();
const RatelimitManager = require('../../managers/RatelimitManager');
const PerformanceManager = require('../../managers/PerformanceManager');

// Apply rate limiting to all API routes
router.use(RatelimitManager.createApiLimiter());

// Health check endpoint
router.get('/health', (req, res) => {
    const metrics = PerformanceManager.getMetrics();
    res.json({
        status: 'healthy',
        uptime: metrics.uptime,
        memory: metrics.memoryUsage,
        cpu: metrics.currentCpuUsage
    });
});

module.exports = router;