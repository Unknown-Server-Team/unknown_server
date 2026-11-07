import express, { Request, Response, Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import VersionManager from '../../managers/VersionManager';
import v1Router from './v1';
import swaggerSpecs from '../../config/swagger';

const router: Router = express.Router();

VersionManager.registerVersion('v1', v1Router);

router.use(VersionManager.createVersionMiddleware());

router.use('/v1', v1Router);

router.get('/versions', (_req: Request, res: Response) => {
    const deprecated = VersionManager
        .getSupportedVersions()
        .filter((version: string): boolean => VersionManager.isDeprecated(version));

    res.json({
        versions: VersionManager.getSupportedVersions(),
        latest: 'v1',
        deprecated
    });
});

router.get('/health', (req: Request, res: Response) => {
    v1Router(req, res, () => {
        if (!res.headersSent) {
            res.status(404).json({ error: 'Not Found' });
        }
    });
});

router.get('/metrics', (req: Request, res: Response) => {
    v1Router(req, res, () => {
        if (!res.headersSent) {
            res.status(404).json({ error: 'Not Found' });
        }
    });
});

router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(swaggerSpecs));

router.get('/docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpecs);
});

export = router;