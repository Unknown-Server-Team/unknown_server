import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import expressLayouts from 'express-ejs-layouts';
import fileUpload from 'express-fileupload';
import swaggerUi from 'swagger-ui-express';
import swaggerSpecs from './config/swagger';
import cluster from 'cluster';
import { createServer, Server } from 'http';
import crypto from 'crypto';
import os from 'os';
import { ServiceConfig, ServiceMeshConfig, ServiceProxyConfig, EnvironmentConfig } from './types';

const LogManager = require('./managers/LogManager');
const PerformanceManager = require('./managers/PerformanceManager');
const WebsocketManager = require('./managers/WebsocketManager');
const AuthMonitor = require('./managers/AuthMonitor');
const SessionManager = require('./managers/SessionManager');
const GatewayManager = require('./managers/GatewayManager');
const ServiceMeshManager = require('./managers/ServiceMeshManager');
const DocGenerator = require('./managers/utils/DocGenerator');
const WorkerThreadManager = require('./managers/WorkerThreadManager');

const db = require('./database/db');
const { initializeQueries } = require('./database/mainQueries');

const isClusterWorker: boolean = cluster.isWorker;

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

app.set('trust proxy', true);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false
}));

app.use(cors());

app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Origin-Agent-Cluster', '?0');
    next();
});

app.use(compression());
app.use(GatewayManager.createGatewayMiddleware());
app.use(ServiceMeshManager.createMeshMiddleware());
app.use(SessionManager.createSessionMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/',
    debug: false
}));

app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(LogManager.requestLogger());

app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime();
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        PerformanceManager.trackRequest(seconds * 1000 + nanoseconds / 1000000, res.statusCode, req.path);
    });
    next();
});

const mainRouter = require('./routers/main');
const apiRouter = require('./routers/api');

app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Unknown Server API Documentation'
}));

app.use('/', mainRouter);
app.use('/api', apiRouter);

app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: true, message: 'Not Found', status: 404 });
    } else {
        res.status(404).render('404');
    }
});

const errorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
    LogManager.error('Server Error', err);
    PerformanceManager.trackError(err, req.path);

    if (req.path.startsWith('/api/')) {
        res.status(500).json({
            error: 'Internal Server Error',
            code: err.code,
            message: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } else {
        res.status(500).render('error', { error: err });
    }
};

app.use(errorHandler);

const startServer = async (): Promise<void> => {
    try {
        const requiredEnvVars: (keyof EnvironmentConfig)[] = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
        const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]?.trim());

        if (missingEnvVars.length > 0) {
            LogManager.warning('Missing mandatory environment variables:', missingEnvVars);
            LogManager.error('Please set the required environment variables. Exiting.');
            process.exit(1);
        }

        if (!isClusterWorker) {
            const banner: string = await LogManager.figlet('UNKNOWN');
            console.log(banner);
        }

        LogManager.info('Initializing server components...');

        const cpuCount = os.cpus().length;
        const serverWorkers = parseInt(process.env.SERVER_WORKERS || cpuCount.toString(), 10);
        const maxThreadsPerProcess = isClusterWorker
            ? Math.max(1, Math.floor(cpuCount / serverWorkers))
            : Math.max(2, Math.floor(cpuCount / 2));

        WorkerThreadManager.initialize({
            maxWorkers: parseInt(process.env.MAX_WORKER_THREADS || maxThreadsPerProcess.toString(), 10)
        });

        if (!isClusterWorker) {
            await DocGenerator.initialize();
            const docValidation = await DocGenerator.validateAllDocs();
            if (!docValidation.isValid) {
                LogManager.warning('Documentation validation issues:', docValidation.errors);
            }
            await DocGenerator.generateVersionDocs();
        }

        const authServiceConfig: ServiceConfig = {
            endpoints: [{ path: '/api/auth', handler: apiRouter }],
            healthCheck: async (): Promise<boolean> => {
                try { await db.query('SELECT 1'); return true; } catch { return false; }
            },
            circuitBreaker: { timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 30000 }
        };
        GatewayManager.registerService('auth', authServiceConfig);

        const usersServiceConfig: ServiceConfig = {
            endpoints: [{ path: '/api/users', handler: apiRouter }],
            cacheTTL: 300,
            maxRetries: 3
        };
        GatewayManager.registerService('users', usersServiceConfig);

        const authMeshConfig: ServiceMeshConfig = {
            name: 'auth-service',
            url: process.env.AUTH_SERVICE_URL || 'http://localhost:3000',
            version: '1.0.0'
        };
        ServiceMeshManager.registerService(authMeshConfig);

        const proxyConfig: ServiceProxyConfig = {
            target: '/api/auth',
            routes: ['/api/auth'],
            loadBalancingStrategy: 'round-robin',
            middleware: [
                async (req: any) => {
                    req.headers['x-request-id'] = crypto.randomBytes(16).toString('hex');
                    req.headers['x-service-version'] = '1.0.0';
                    if (isClusterWorker) req.headers['x-worker-id'] = process.pid.toString();
                }
            ]
        };
        ServiceMeshManager.setupServiceProxy('auth-service', proxyConfig);

        await initializeQueries();

        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            AuthMonitor.startMonitoring();
        }

        const server: Server = createServer(app);
        server.listen(PORT, '0.0.0.0', () => {
            LogManager.success(`Server running on port ${PORT}`);
            LogManager.info(`Worker threads: ${WorkerThreadManager.maxWorkers}`);
            if (process.env.pm_id) LogManager.info(`PM2 process ID: ${process.env.pm_id}`);
            if (isClusterWorker) LogManager.info(`Cluster worker PID: ${process.pid}`);
            if (process.env.NODE_APP_INSTANCE) LogManager.info(`Cluster instance: ${process.env.NODE_APP_INSTANCE}`);
        });

        WebsocketManager.initialize(server, { isClusterWorker, workerId: process.pid });
        WebsocketManager.initializeAuthEvents();
        WebsocketManager.startHeartbeat();

        let metricsInterval: NodeJS.Timeout | null = null;
        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            PerformanceManager.logMetrics();
            metricsInterval = setInterval(() => {
                PerformanceManager.logMetrics();
                LogManager.info('API Gateway Health', GatewayManager.getServiceHealth());
                LogManager.info('Service Mesh Metrics', ServiceMeshManager.getServiceMetrics());
            }, 300000);
        }

        const shutdown = async (): Promise<void> => {
            LogManager.info(`Process ${process.pid} received shutdown signal`);
            if (metricsInterval && (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0')) {
                clearInterval(metricsInterval);
            }
            WebsocketManager.close();
            await WorkerThreadManager.shutdownAll();
            await db.close();
            server.close(() => {
                LogManager.success(`Server ${process.pid} shut down`);
                if (!isClusterWorker) process.exit(0);
            });
            setTimeout(() => {
                LogManager.error(`Force closing server ${process.pid} after timeout`);
                if (!isClusterWorker) process.exit(1);
            }, 5000);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error) {
        LogManager.error('Failed to start server', error);
        process.exit(1);
    }
};

startServer();
