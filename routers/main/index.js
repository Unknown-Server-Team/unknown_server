const express = require('express');
const router = express.Router();

const docsRouter = require('./docs');
const { RatelimitManager } = require('../../managers/RatelimitManager');
const PerformanceManager = require('../../managers/PerformanceManager');
const GatewayManager = require('../../managers/GatewayManager');
const ServiceMeshManager = require('../../managers/ServiceMeshManager');

router.use(RatelimitManager.createApiLimiter());

router.get('/', (req, res) => {
    res.render('index');
});

router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        name: process.env.SERVICE_NAME || 'unknown-server',
        version: process.env.VERSION
    });
});

router.use('/docs', docsRouter);

module.exports = router;