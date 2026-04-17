import express, { Request, Response, Router } from 'express';
import swaggerUi from 'swagger-ui-express';

const VersionManager = require('../../managers/VersionManager');
const v1Router = require('./v1');
const swaggerSpecs = require('../../config/swagger');

const router: Router = express.Router();

VersionManager.registerVersion('v1', v1Router);

router.use(VersionManager.createVersionMiddleware());

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
router.get('/versions', (_req: Request, res: Response) => {
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
    v1Router.handle(req, res);
});

router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(swaggerSpecs));

router.get('/docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpecs);
});

export = router;