import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import fileUpload from 'express-fileupload';
import swaggerUi from 'swagger-ui-express';
import swaggerSpecs from './config/swagger';
import cluster from 'cluster';
import { createServer, Server } from 'http';
import crypto from 'crypto';
import os from 'os';
import expressLayouts from 'express-ejs-layouts';

import { ServiceMeshConfig, EnvironmentConfig } from './types';
import type { GatewayHandler, ServiceRegistrationOptions } from './types/gateway';
import type { RouteConfig } from './types/serviceMesh';
import DocGenerator from './managers/utils/DocGenerator';
import LogManager from './managers/LogManager';
import PerformanceManager from './managers/PerformanceManager';
import WebsocketManager from './managers/WebsocketManager';
import AuthMonitor from './managers/AuthMonitor';
import SessionManager from './managers/SessionManager';
import GatewayManager from './managers/GatewayManager';
import ServiceMeshManager from './managers/ServiceMeshManager';
import WorkerThreadManager from './managers/WorkerThreadManager';
import db from './database/db';
import databaseQueries from './database/mainQueries';
import mainRouter from './routers/main';
import apiRouter from './routers/api';

function hasMutableHeaders(value: unknown): value is { headers: Record<string, string> } {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as { headers?: unknown };
    return typeof candidate.headers === 'object' && candidate.headers !== null;
}
const apiGatewayHandler = apiRouter as unknown as GatewayHandler;

const isClusterWorker: boolean = cluster.isWorker;

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

app.set('trust proxy', true);

// I'm losing my mind with CORS -- Perhaps I just need to learn how to multiply.
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
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(LogManager.requestLogger());

app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime();
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const responseTime = seconds * 1000 + nanoseconds / 1000000;
        PerformanceManager.trackRequest(responseTime, res.statusCode, req.path);
    });
    next();
});

app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "Unknown Server API Documentation"
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

const errorHandler: ErrorRequestHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const errorDetails = err instanceof Error ? err : new Error(String(err));
    LogManager.error('Server Error', errorDetails);
    PerformanceManager.trackError(errorDetails, req.path);
    const errorWithCode = errorDetails as Error & { code?: string | number };

    if (req.path.startsWith('/api/')) {
        res.status(500).json({
            error: 'Internal Server Error',
            code: errorWithCode.code,
            message: process.env.NODE_ENV === 'development' ? errorDetails.message : undefined
        });
    } else {
        res.status(500).render('error', { error: errorDetails });
    }
};

app.use(errorHandler);

const startServer = async (): Promise<void> => {
    try {
        const requiredEnvVars: (keyof EnvironmentConfig)[] = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
        const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName]?.trim() === '');
        
        if (missingEnvVars.length > 0) {
            LogManager.warning('Missing mandatory environment variables:', { missingEnvVars });
            LogManager.error('Please set the required environment variables before starting the server. Exiting with code 1.');
            process.exit(1);
        }

        if (!isClusterWorker) {
            const banner: string = await LogManager.figlet('UNKNOWN');
            console.log(banner);
        }

        LogManager.info('Initializing server components...');

        LogManager.info('Initializing worker thread pool...');
        const cpuCount = os.cpus().length;
        const serverWorkers = parseInt(process.env.SERVER_WORKERS || cpuCount.toString(), 10);
        const maxThreadsPerProcess = isClusterWorker ? 
            Math.max(1, Math.floor(cpuCount / serverWorkers)) : 
            Math.max(2, Math.floor(cpuCount / 2));
            
        WorkerThreadManager.initialize({
            maxWorkers: parseInt(process.env.MAX_WORKER_THREADS || maxThreadsPerProcess.toString(), 10)
        });

        if (!isClusterWorker) {
            LogManager.info('Initializing documentation system...');
            await DocGenerator.initialize();

            LogManager.info('Validating API documentation...');
            const docValidation = await DocGenerator.validateAllDocs();
            if (!docValidation.isValid) {
                LogManager.warning('Documentation validation issues:', { errors: docValidation.errors });
            }

            LogManager.info('Generating versioned API documentation...');
            await DocGenerator.generateVersionDocs();
        }

        const authServiceConfig: ServiceRegistrationOptions = {
            endpoints: [
                { path: '/api/auth', handler: apiGatewayHandler },
            ],
            healthCheck: async (): Promise<boolean> => {
                try {
                    await db.query('SELECT 1');
                    return true;
                } catch (error) {
                    return false;
                }
            },
            circuitBreaker: {
                timeout: 5000,
                errorThresholdPercentage: 50,
                resetTimeout: 30000
            }
        };

        GatewayManager.registerService('auth', authServiceConfig);

        const usersServiceConfig: ServiceRegistrationOptions = {
            endpoints: [
                { path: '/api/users', handler: apiGatewayHandler },
            ],
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

        const proxyConfig: RouteConfig = {
            target: '/api/auth',
            routes: ['/api/auth'],
            loadBalancingStrategy: 'round-robin',
            middleware: [
                async (req: unknown) => {
                    if (!hasMutableHeaders(req)) {
                        return;
                    }

                    req.headers['x-request-id'] = crypto.randomBytes(16).toString('hex');
                    req.headers['x-service-version'] = '1.0.0';
                    if (isClusterWorker) {
                        req.headers['x-worker-id'] = process.pid.toString();
                    }
                }
            ]
        };

        ServiceMeshManager.setupServiceProxy('auth-service', proxyConfig);

        LogManager.info('Initializing database...');
        await databaseQueries.initializeQueries();

        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            AuthMonitor.startMonitoring();
        }

        const server: Server = createServer(app);
        server.listen(PORT, '0.0.0.0', () => {
            LogManager.success(`Server is running on port ${PORT}`);
            LogManager.info('Server running behind NGINX reverse proxy');
            
            LogManager.info(`Worker threads available: ${WorkerThreadManager.getStats().maxWorkers}`);
            if (process.env.pm_id) {
                LogManager.info(`Running under PM2 process manager (ID: ${process.env.pm_id})`);
            }
            if (isClusterWorker) {
                LogManager.info(`Cluster worker: ${process.pid}`);
            }
            if (process.env.NODE_APP_INSTANCE) {
                LogManager.info(`Cluster instance: ${process.env.NODE_APP_INSTANCE}`);
            }
        });

        LogManager.info('Initializing WebSocket server...');
        WebsocketManager.initialize(server, { 
            isClusterWorker, 
            workerId: process.pid 
        });
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
                LogManager.success(`Server ${process.pid} shut down successfully`);
                if (!isClusterWorker) {
                    process.exit(0);
                }
            });

            setTimeout(() => {
                LogManager.error(`Force closing server ${process.pid} after timeout`);
                if (!isClusterWorker) {
                    process.exit(1);
                }
            }, 5000);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error: unknown) {
        LogManager.error('Failed to start server', error instanceof Error ? error : new Error(String(error)));
        process.exit(1);
    }
};

startServer();