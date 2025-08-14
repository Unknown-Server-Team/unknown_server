import express, { Request, Response, Router } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const { RatelimitManager } = require('../../managers/RatelimitManager');
const VersionManager = require('../../managers/VersionManager');
const v1Router = require('./v1');
const swaggerSpecs = require('../../config/swagger');

const router: Router = express.Router();

// Initialize version manager with v1 routes
VersionManager.registerVersion('v1', v1Router);

// Apply version middleware
router.use(VersionManager.createVersionMiddleware());

// Version-specific routes
router.use('/v1', v1Router);

/**
 * @swagger
 * /api/versions:
 *   get:
 *     tags:
 *       - System
 *     summary: Get available API versions
 *     description: Returns information about all supported API versions
 *     responses:
 *       200:
 *         description: Available API versions
 */
router.get('/versions', (req: Request, res: Response) => {
    res.json({
        versions: VersionManager.getSupportedVersions(),
        latest: 'v1',
        deprecated: Array.from(VersionManager.deprecatedVersions) || []
    });
});

/**
 * @swagger
 * /api/health:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API health status
 *     description: Returns the current health status of the API (alias for /api/v1/health for backward compatibility)
 *     responses:
 *       200:
 *         description: Health check information
 */
router.get('/health', (req: Request, res: Response) => {
    // Redirect to v1 health endpoint for backward compatibility
    v1Router.handle(req, res);
});

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API performance metrics
 *     description: Returns detailed performance metrics of the API (alias for /api/v1/metrics for backward compatibility)
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [hour, day, week]
 *         description: Time period for metrics data
 *     responses:
 *       200:
 *         description: Performance metrics
 */
router.get('/metrics', (req: Request, res: Response) => {
    // Redirect to v1 metrics endpoint for backward compatibility
    v1Router.handle(req, res);
});

// Documentation routes
router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(swaggerSpecs));

// Serve OpenAPI spec
router.get('/docs.json', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpecs);
});

export = router;