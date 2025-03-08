const express = require('express');
const router = express.Router();
const { RatelimitManager } = require('../../../managers/RatelimitManager');
const authRouter = require('./auth');
const usersRouter = require('./users');
const os = require('os');
const LogManager = require('../../../managers/LogManager');
const PerformanceManager = require('../../../managers/PerformanceManager');

// Apply rate limiting to all API routes
router.use(RatelimitManager.createApiLimiter());

// Auth routes
router.use('/auth', authRouter);

// Users routes
router.use('/users', usersRouter);

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API health status
 *     description: Returns the current health status and performance metrics of the API
 *     responses:
 *       200:
 *         description: Health check information
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: 'v1',
        timestamp: new Date().toISOString()
    });
});

/**
 * @swagger
 * /api/v1/metrics:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API performance metrics
 *     description: Returns detailed performance metrics of the API
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [hour, day, week]
 *         description: Time period for metrics data
 *     responses:
 *       200:
 *         description: Performance metrics
 */
router.get('/metrics', (req, res) => {
    const period = req.query.period || 'hour';
    
    // Get real metrics from PerformanceManager
    const metrics = PerformanceManager.getMetrics();
    
    // Get memory usage
    const memoryUsage = process.memoryUsage();
    
    // Filter metrics based on the requested period
    const now = Date.now();
    let periodMs;
    
    switch (period) {
        case 'hour':
            periodMs = 60 * 60 * 1000; // 1 hour
            break;
        case 'day':
            periodMs = 24 * 60 * 60 * 1000; // 24 hours
            break;
        case 'week':
            periodMs = 7 * 24 * 60 * 60 * 1000; // 7 days
            break;
        default:
            periodMs = 60 * 60 * 1000; // Default to 1 hour
    }
    
    const periodStart = now - periodMs;
    
    // Filter response time history for the requested period
    const filteredResponseTimes = metrics.responseTimeHistory.filter(entry => entry.timestamp >= periodStart);
    const filteredRequestsPerMinute = metrics.requestsPerMinute.filter(entry => entry.timestamp >= periodStart);
    
    // Calculate request metrics for the period
    const totalRequests = filteredRequestsPerMinute.reduce((sum, entry) => sum + entry.count, 0);
    const totalErrors = filteredRequestsPerMinute.reduce((sum, entry) => sum + entry.errors, 0);
    const successRate = totalRequests > 0 ? ((totalRequests - totalErrors) / totalRequests * 100).toFixed(2) : 100;
    const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : 0;
    const avgResponseTime = filteredResponseTimes.length > 0 ? 
        filteredResponseTimes.reduce((sum, entry) => sum + entry.responseTime, 0) / filteredResponseTimes.length : 0;
    
    // Get endpoint statistics
    const endpointStats = {};
    Object.entries(metrics.endpoints)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10) // Top 10 endpoints
        .forEach(([endpoint, stats]) => {
            endpointStats[endpoint] = {
                count: stats.count,
                avgResponseTime: stats.avgTime.toFixed(2),
                lastUsed: new Date(stats.lastUsed).toISOString()
            };
        });
    
    // Get slowest endpoints
    const slowestEndpoints = Array.from(metrics.slowestEndpoints)
        .filter(([_, data]) => data.timestamp >= periodStart)
        .sort((a, b) => b[1].responseTime - a[1].responseTime)
        .slice(0, 5)
        .map(([endpoint, data]) => ({
            endpoint,
            responseTime: data.responseTime,
            timestamp: new Date(data.timestamp).toISOString()
        }));
    
    res.json({
        period,
        uptime: metrics.uptime,
        cpu: {
            usage: metrics.currentCpuUsage,
            cores: os.cpus().length,
            loadAverage: os.loadavg()
        },
        memory: metrics.memoryUsage,
        requests: {
            total: totalRequests,
            successRate: parseFloat(successRate),
            errorRate: parseFloat(errorRate),
            perMinute: totalRequests / (periodMs / 60000),
            avgResponseTime: avgResponseTime.toFixed(2)
        },
        statusCodes: metrics.statusCodes,
        topEndpoints: endpointStats,
        slowestEndpoints,
        trends: metrics.trends,
        timestamp: new Date().toISOString()
    });
});

/**
 * @swagger
 * /api/v1/routes:
 *   get:
 *     tags:
 *       - System
 *     summary: Get all API routes
 *     description: Returns information about all available API routes
 *     responses:
 *       200:
 *         description: List of API routes
 */
router.get('/routes', (req, res) => {
    // Extract routes from router stack
    const routes = [];
    
    // Helper function to extract routes from a router
    function extractRoutes(router, basePath = '') {
        if (!router.stack) return;
        
        router.stack.forEach(layer => {
            if (layer.route) {
                // It's a route
                const path = basePath + layer.route.path;
                Object.keys(layer.route.methods).forEach(method => {
                    if (layer.route.methods[method]) {
                        routes.push({
                            path,
                            method,
                            protected: path.includes('/auth/') || 
                                      path.includes('/users/') || 
                                      (layer.route.stack && 
                                      layer.route.stack.some(s => 
                                        s.name === 'authenticate' || 
                                        s.name === 'authorize'
                                      ))
                        });
                    }
                });
            } else if (layer.name === 'router') {
                // It's a sub-router
                let newPath = basePath;
                if (layer.regexp && layer.regexp.fast_slash === false) {
                    // Extract path from regexp
                    newPath = basePath + (layer.regexp.toString().match(/^\/\^((?:\\\/|[^\/])+)/) || ['', ''])[1]
                                .replace(/\\(.)/g, '$1');
                }
                extractRoutes(layer.handle, newPath);
            }
        });
    }
    
    // Extract routes from this router
    extractRoutes(router, '/api/v1');
    
    // Add auth routes
    extractRoutes(authRouter, '/api/v1/auth');
    
    // Add users routes
    extractRoutes(usersRouter, '/api/v1/users');
    
    res.json(routes);
});

module.exports = router;