require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const expressLayouts = require('express-ejs-layouts');

// Import managers
const LogManager = require('./managers/LogManager');
const RatelimitManager = require('./managers/RatelimitManager');
const PerformanceManager = require('./managers/PerformanceManager');
const WebsocketManager = require('./managers/WebsocketManager');

// Import routers
const mainRouter = require('./routers/main');
const apiRouter = require('./routers/api');

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
            styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com", "https:"],
            styleSrcElem: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com", "https:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "https:"],
            scriptSrcElem: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "fonts.gstatic.com", "fonts.googleapis.com", "https:", "data:"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(compression());

// General middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Add request logging middleware
app.use(LogManager.requestLogger());

// Performance monitoring middleware
app.use((req, res, next) => {
    const start = process.hrtime();
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const responseTime = seconds * 1000 + nanoseconds / 1000000;
        PerformanceManager.trackRequest(responseTime, res.statusCode, req.path);
    });
    next();
});

// Routes
app.use('/', mainRouter);
app.use('/api', apiRouter);

// 404 handler
app.use((req, res) => {
    // Check if the request is for the API
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: true, status: 404, message: "Not found" });
    } else {
        res.status(404).render('404');
    }
});

// Error handling
app.use((err, req, res, next) => {
    LogManager.error('Server Error', err);
    PerformanceManager.trackError(err, req.path);

    // Check if the request is for the API
    if (req.path.startsWith('/api/')) {
        res.status(500).json({ error: true, status: 500, message: 'Internal Server Error' });
    } else {
        res.status(500).render('error', { error: err });
    }
});

// Initialize server
const startServer = async () => {
    try {
        // Display ASCII art
        const banner = await LogManager.figlet('UNKNOWN');
        console.log(banner);

        // Startup sequence
        LogManager.info('Initializing Unknown Server...', { env: process.env.NODE_ENV || 'development' });
        
        // Database initialization
        LogManager.info('Initializing database connection...');
        await initializeQueries();
        LogManager.success('Database initialized successfully');

        // Create HTTP server
        const server = app.listen(PORT, () => {
            LogManager.success(`Server is running on port ${PORT}`);
            LogManager.info('Server URLs:', {
                local: `http://localhost:${PORT}`,
                network: `http://${require('os').hostname()}:${PORT}`
            });
        });

        // Initialize WebSocket with new logging
        LogManager.info('Initializing WebSocket server...');
        WebsocketManager.initialize(server);
        WebsocketManager.startHeartbeat();
        LogManager.success('WebSocket server is ready');

        // Log initial performance metrics
        LogManager.info('Collecting initial performance metrics...');
        PerformanceManager.logMetrics();
        LogManager.success('Server initialization complete');
        LogManager.info("Metrics logs will be shown every 5 minutes");
        
        const metricsInterval = setInterval(() => {
            PerformanceManager.logMetrics();
        }, 300000);

        // Graceful shutdown
        const shutdown = async () => {
            LogManager.info('Received shutdown signal');

            // Clear metrics interval
            clearInterval(metricsInterval);
            LogManager.info('Cleared metrics interval');
            
            // Close WebSocket connections
            LogManager.info('Closing WebSocket connections...');
            WebsocketManager.close();
            
            // Close database connections
            LogManager.info('Closing database connections...');
            await db.close();
            
            // Close HTTP server
            server.close(() => {
                LogManager.success('All connections closed successfully');
                process.exit(0);
            });

            // Force exit after 5 seconds
            setTimeout(() => {
                LogManager.error('Could not close connections in time', new Error('Shutdown timeout'));
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