import express, { Request, Response, Router } from 'express';

// Import sub-routers
const docsRouter = require('./docs');
const { RatelimitManager } = require('../../managers/RatelimitManager');
const PerformanceManager = require('../../managers/PerformanceManager');
const GatewayManager = require('../../managers/GatewayManager');
const ServiceMeshManager = require('../../managers/ServiceMeshManager');

const router: Router = express.Router();

// Apply rate limiting
router.use(RatelimitManager.createApiLimiter());

// Main routes
router.get('/', (req: Request, res: Response) => {
    res.render('index');
});

// Health check endpoint for service mesh
router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        name: process.env.SERVICE_NAME || 'unknown-server',
        version: process.env.VERSION
    });
});

// Documentation routes
router.use('/docs', docsRouter);

export = router;