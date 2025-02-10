require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const expressLayouts = require('express-ejs-layouts');
const fileUpload = require('express-fileupload');

// Import managers
const LogManager = require('./managers/LogManager');
const RatelimitManager = require('./managers/RatelimitManager');
const PerformanceManager = require('./managers/PerformanceManager');
const WebsocketManager = require('./managers/WebsocketManager');
const AuthMonitor = require('./managers/AuthMonitor');
const SessionManager = require('./managers/SessionManager');

// Import database
const db = require('./database/db');
const { initializeQueries } = require('./database/mainQueries');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "fonts.gstatic.com", "https:", "data:"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));

app.use(compression());

// Session handling
app.use(SessionManager.createSessionMiddleware());

// Request parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/',
    debug: process.env.NODE_ENV === 'development'
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

// Routes
app.use('/', mainRouter);
app.use('/api', apiRouter);

// Error handling
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
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
        const banner = await LogManager.figlet('UNKNOWN');
        console.log(banner);

        // Initialize components
        LogManager.info('Initializing server components...');
        
        // Initialize database queries
        LogManager.info('Initializing database...');
        await initializeQueries();
        
        // Start monitoring systems
        AuthMonitor.startMonitoring();
        
        // Create HTTP server
        const server = app.listen(PORT, () => {
            LogManager.success(`Server is running on port ${PORT}`);
            LogManager.info('Server URLs:', {
                local: `http://localhost:${PORT}`,
                network: `http://${require('os').hostname()}:${PORT}`
            });
        });

        // Initialize WebSocket
        LogManager.info('Initializing WebSocket server...');
        WebsocketManager.initialize(server);
        WebsocketManager.initializeAuthEvents();
        WebsocketManager.startHeartbeat();

        // Start performance monitoring
        PerformanceManager.logMetrics();
        const metricsInterval = setInterval(() => {
            PerformanceManager.logMetrics();
        }, 300000); // Every 5 minutes

        // Graceful shutdown
        const shutdown = async () => {
            LogManager.info('Received shutdown signal');
            
            clearInterval(metricsInterval);
            WebsocketManager.close();
            
            await db.close();
            
            server.close(() => {
                LogManager.success('Server shut down successfully');
                process.exit(0);
            });

            setTimeout(() => {
                LogManager.error('Force closing server after timeout');
                process.exit(1);
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