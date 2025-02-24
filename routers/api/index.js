const express = require('express');
const router = express.Router();
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { RatelimitManager } = require('../../managers/RatelimitManager');
const VersionManager = require('../../managers/VersionManager');
const v1Router = require('./v1');

// Initialize version manager with v1 routes
VersionManager.registerVersion('v1', v1Router);

// Apply version middleware
router.use(VersionManager.createVersionMiddleware());

// Version-specific routes
router.use('/v1', v1Router);

// Get available versions
router.get('/versions', (req, res) => {
    res.json({
        versions: VersionManager.getSupportedVersions(),
        latest: 'v1',
        deprecated: Array.from(VersionManager.deprecatedVersions)
    });
});

// Documentation routes
router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(require('../../config/swagger')));

// Serve OpenAPI spec
router.get('/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(require('../../config/swagger'));
});

module.exports = router;