import express, { Request, Response, Router } from 'express';

const docsRouter = require('./docs');
const { RatelimitManager } = require('../../managers/RatelimitManager');
const PerformanceManager = require('../../managers/PerformanceManager');
const GatewayManager = require('../../managers/GatewayManager');
const ServiceMeshManager = require('../../managers/ServiceMeshManager');

const router: Router = express.Router();

router.use(RatelimitManager.createApiLimiter());

router.get('/', (req: Request, res: Response) => {
    res.render('index');
});

router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        name: process.env.SERVICE_NAME || 'unknown-server',
        version: process.env.VERSION
    });
});

router.use('/docs', docsRouter);

export = router;