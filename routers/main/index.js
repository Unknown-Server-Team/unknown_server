const express = require('express');
const router = express.Router();

// Import sub-routers
const docsRouter = require('./docs');
const { RatelimitManager } = require('../../managers/RatelimitManager');
const PerformanceManager = require('../../managers/PerformanceManager');
const GatewayManager = require('../../managers/GatewayManager');
const ServiceMeshManager = require('../../managers/ServiceMeshManager');

router.use(RatelimitManager.createApiLimiter());

// Main routes
router.get('/', (req, res) => {
    res.render('index');
});

// Health check endpoint for service mesh
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        name: process.env.SERVICE_NAME || 'unknown-server',
        version: process.env.VERSION
    });
});

// Documentation routes
router.use('/docs', docsRouter);

module.exports = router;