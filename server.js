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

// Import managers
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

// Import database
const db = require('./database/db');
const { initializeQueries } = require('./database/mainQueries');

// Detect if we're running in a cluster worker
const isClusterWorker = cluster.isWorker;

const app = express();
const PORT = process.env.PORT || 3000;

// Trust NGINX proxy
app.set('trust proxy', true);

// Security middleware - Minimal settings for local development
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

// Simplified CORS settings for development
app.use(cors());

// Local development specific headers
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Origin-Agent-Cluster', '?0');
    next();
});

app.use(compression());

// API Gateway and Service Mesh middleware
app.use(GatewayManager.createGatewayMiddleware());
app.use(ServiceMeshManager.createMeshMiddleware());

// Session handling
app.use(SessionManager.createSessionMiddleware());

// Request parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/',
    debug: false
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Add request logging
app.use(LogManager.requestLogger());

// Performance monitoring
app.use((req, res, next) => {
    const start = process.hrtime();
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const responseTime = seconds * 1000 + nanoseconds / 1000000;
        PerformanceManager.trackRequest(responseTime, res.statusCode, req.path);
    });
    next();
});

// Initialize routers
const mainRouter = require('./routers/main');
const apiRouter = require('./routers/api');

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "Unknown Server API Documentation"
}));

// Routes
app.use('/', mainRouter);
app.use('/api', apiRouter);

// Error handling
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

// Server initialization
const startServer = async () => {
    try {
        // Check for required env variables
        const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
        const missingEnnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');
        if (missingEnnvVars.length > 0) {
            LogManager.warning('Missing mandatory environment variables:', missingEnnvVars);
            LogManager.error('Please set the required environment variables before starting the server. Exitting with code 1.');
            process.exit(1);
        }

        // Only show banner in the primary process or if not in cluster mode
        if (!isClusterWorker) {
            const banner = await LogManager.figlet('UNKNOWN');
            console.log(banner);
        }

        // Initialize components
        LogManager.info('Initializing server components...');

        // Initialize WorkerThreadManager with a worker count based on 
        // whether we're in cluster mode or not
        LogManager.info('Initializing worker thread pool...');
        const maxThreadsPerProcess = isClusterWorker ? 
            Math.max(1, Math.floor(require('os').cpus().length / (process.env.SERVER_WORKERS || require('os').cpus().length))) : 
            Math.max(2, Math.floor(require('os').cpus().length / 2));
            
        WorkerThreadManager.initialize({
            maxWorkers: process.env.MAX_WORKER_THREADS || maxThreadsPerProcess
        });

        // Initialize documentation system - only need to do this in primary process
        if (!isClusterWorker) {
            LogManager.info('Initializing documentation system...');
            await DocGenerator.initialize();

            // Validate API documentation
            LogManager.info('Validating API documentation...');
            const docValidation = await DocGenerator.validateAllDocs();
            if (!docValidation.isValid) {
                LogManager.warning('Documentation validation issues:', docValidation.errors);
            }

            // Generate versioned documentation
            LogManager.info('Generating versioned API documentation...');
            await DocGenerator.generateVersionDocs();
        }

        // Register core service endpoints
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

        // Configure service mesh routes
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
                    // Add tracking headers
                    req.headers['x-request-id'] = require('crypto').randomBytes(16).toString('hex');
                    req.headers['x-service-version'] = '1.0.0';
                    // Add worker identification to help with debugging
                    if (isClusterWorker) {
                        req.headers['x-worker-id'] = process.pid.toString();
                    }
                }
            ]
        });

        // Initialize database queries
        LogManager.info('Initializing database...');
        await initializeQueries();

        // Start monitoring systems - avoid duplicate monitors in clustered environment
        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            AuthMonitor.startMonitoring();
        }

        // Create HTTP server
        const server = app.listen(PORT, '0.0.0.0', () => {
            LogManager.success(`Server is running on port ${PORT}`);
            LogManager.info('Server running behind NGINX reverse proxy');
            
            // Log worker and processing information
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

        // Initialize WebSocket with sticky sessions for clustered environment
        LogManager.info('Initializing WebSocket server...');
        WebsocketManager.initialize(server, { 
            isClusterWorker, 
            workerId: process.pid 
        });
        WebsocketManager.initializeAuthEvents();
        WebsocketManager.startHeartbeat();

        // Start performance monitoring - only in primary process or in first worker
        // to avoid duplicate metrics reporting
        if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
            PerformanceManager.logMetrics();
            const metricsInterval = setInterval(() => {
                PerformanceManager.logMetrics();

                // Log Gateway and Service Mesh metrics
                LogManager.info('API Gateway Health', GatewayManager.getServiceHealth());
                LogManager.info('Service Mesh Metrics', ServiceMeshManager.getServiceMetrics());
            }, 300000); // Every 5 minutes
        }

        // Graceful shutdown
        const shutdown = async () => {
            LogManager.info(`Process ${process.pid} received shutdown signal`);

            // Clear interval only if it was created in this process
            if (!isClusterWorker || process.env.NODE_APP_INSTANCE === '0') {
                clearInterval(metricsInterval);
            }
            
            WebsocketManager.close();
            
            // Shut down worker threads
            await WorkerThreadManager.shutdownAll();

            // Close database connections
            await db.close();

            // Close the HTTP server
            server.close(() => {
                LogManager.success(`Server ${process.pid} shut down successfully`);
                // In clustered mode, don't call process.exit() directly,
                // let the cluster manager handle it
                if (!isClusterWorker) {
                    process.exit(0);
                }
            });

            // Set a timeout for force shutdown if graceful shutdown fails
            setTimeout(() => {
                LogManager.error(`Force closing server ${process.pid} after timeout`);
                if (!isClusterWorker) {
                    process.exit(1);
                }
            }, 5000);
        };

        // Register shutdown handlers
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error) {
        LogManager.error('Failed to start server', error);
        process.exit(1);
    }
};

startServer();