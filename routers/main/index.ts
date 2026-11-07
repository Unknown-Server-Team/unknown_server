import express, { Request, Response, Router } from 'express';
import docsRouter from './docs';
import { RatelimitManager } from '../../managers/RatelimitManager';
import { APP_VERSION } from '../../config/version';

const router: Router = express.Router();

router.use(RatelimitManager.createApiLimiter());

router.get('/', (_req: Request, res: Response) => {
    res.render('index');
});

router.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        name: process.env.SERVICE_NAME || 'unknown-server',
        version: APP_VERSION
    });
});

router.use('/docs', docsRouter);

export = router;