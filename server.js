/**
 * If you are reading this, you are probably interested in how this server works.
 * This is the main entry point for the server, where all the components are initialized.
 * The server is built using Express.js, a popular web framework for Node.js.
 * Important: This server is designed to run behind an NGINX reverse proxy.
 * Important: This server is running by default in development mode. Adjust security settings for production before deployment.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const expressLayouts = require('express-ejs-layouts');
const fileUpload = require('express-fileupload');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const cluster = require('cluster');

const LogManager = require('./managers/LogManager');
const PerformanceManager = require('./managers/PerformanceManager');
const WebsocketManager = require('./managers/WebsocketManager');
const AuthMonitor = require('./managers/AuthMonitor');
const SessionManager = require('./managers/SessionManager');
const GatewayManager = require('./managers/GatewayManager');
const ServiceMeshManager = require('./managers/ServiceMeshManager');
const DocumentationValidator = require('./managers/DocumentationValidator');
const DocGenerator = require('./managers/utils/DocGenerator');
const WorkerThreadManager = require('./managers/WorkerThreadManager');

const db = require('./database/db');
const { initializeQueries } = require('./database/mainQueries');

const isClusterWorker = cluster.isWorker;

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use((req, res, next) => {
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

app.use((req, res, next) => {
    const start = process.hrtime();
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const responseTime = seconds * 1000 + nanoseconds / 1000000;
        PerformanceManager.trackRequest(responseTime, res.statusCode, req.path);
    });
    next();
});

const mainRouter = require('./routers/main');
const apiRouter = require('./routers/api');

app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "Unknown Server API Documentation"
}));

app.use('/', mainRouter);
app.use('/api', apiRouter);

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: true, message: 'Not Found', status: 404 });
    } else {
        res.status(404).render('404');
    }
});

app.use((err, req, res, next) => {
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
});

const startServer = async () => {
    try {
        const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
        const missingEnnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');
        if (missingEnnvVars.length > 0) {
            LogManager.warning('Missing mandatory environment variables:', missingEnnvVars);
            LogManager.error('Please set the required environment variables before starting the server. Exitting with code 1.');
            process.exit(1);
        }

        if (!isClusterWorker) {
            const banner = await LogManager.figlet('UNKNOWN');
            console.log(banner);
        }

        LogManager.info('Initializing server components...');

        LogManager.info('Initializing worker thread pool...');
        const maxThreadsPerProcess = isClusterWorker ?
            Math.max(1, Math.floor(require('os').cpus().length / (process.env.SERVER_WORKERS || require('os').cpus().length))) :
            Math.max(2, Math.floor(require('os').cpus().length / 2));

        WorkerThreadManager.initialize({
            maxWorkers: process.env.MAX_WORKER_THREADS || maxThreadsPerProcess
        });

        if (!isClusterWorker) {
            LogManager.info('Initializing documentation system...');
            await DocGenerator.initialize();

            LogManager.info('Validating API documentation...');
            const docValidation = await DocGenerator.validateAllDocs();
            if (!docValidation.isValid) {
                LogManager.warning('Documentation validation issues:', docValidation.errors);
            }

            LogManager.info('Generating versioned API documentation...');
            await DocGenerator.generateVersionDocs();
        }

        GatewayManager.registerService('auth', {
            endpoints: [
                { path: '/api/auth', handler: apiRouter },
            ],
            healthCheck: async () => {
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
        });

        GatewayManager.registerService('users', {
            endpoints: [
                { path: '/api/users', handler: apiRouter },
            ],
            cacheTTL: 300,
            maxRetries: 3
        });

        ServiceMeshManager.registerService({
            name: 'auth-service',
            url: process.env.AUTH_SERVICE_URL || 'http://localhost:3000',
            version: '1.0.0'
        });

        ServiceMeshManager.setupServiceProxy('auth-service', {
            target: '/api/auth',
            routes: ['/api/auth'],
            loadBalancingStrategy: 'round-robin',
            middleware: [
                async (req) => {
                    req.headers['x-request-id'] = require('crypto').randomBytes(16).toString('hex');
                    req.headers['x-service-version'] = '1.0.0';
                    if (isClusterWorker) {
                        req.headers['x-worker-id'] = process.pid.toString();
                    }
                }
            ]
        });

        LogManager.info('Initializing database...');
        await initializeQueries();

        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            AuthMonitor.startMonitoring();
        }

        const server = app.listen(PORT, '0.0.0.0', () => {
            LogManager.success(`Server is running on port ${PORT}`);
            LogManager.info('Server running behind NGINX reverse proxy');

            LogManager.info(`Worker threads available: ${WorkerThreadManager.maxWorkers}`);
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

        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            PerformanceManager.logMetrics();
            const metricsInterval = setInterval(() => {
                PerformanceManager.logMetrics();

                LogManager.info('API Gateway Health', GatewayManager.getServiceHealth());
                LogManager.info('Service Mesh Metrics', ServiceMeshManager.getServiceMetrics());
            }, 300000);
        }

        const shutdown = async () => {
            LogManager.info(`Process ${process.pid} received shutdown signal`);

            if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
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

    } catch (error) {
        LogManager.error('Failed to start server', error);
        process.exit(1);
    }
};

startServer();