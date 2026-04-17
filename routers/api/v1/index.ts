import express, { Request, Response, Router } from 'express';
import os from 'os';
import { RatelimitManager } from '../../../managers/RatelimitManager';
import authRouter from './auth';
import usersRouter from './users';
import PerformanceManager from '../../../managers/PerformanceManager';

interface ApiRoute {
    path: string;
    method: string;
    protected: boolean;
}

interface EndpointStats {
    [endpoint: string]: {
        count: number;
        avgResponseTime: string;
        lastUsed: string;
    };
}

interface MetricsResponse {
    period: string;
    uptime: string;
    cpu: {
        usage: string;
        cores: number;
        loadAverage: number[];
    };
    memory: any;
    requests: {
        total: number;
        successRate: number;
        errorRate: number;
        perMinute: number;
        avgResponseTime: string;
    };
    statusCodes: any;
    topEndpoints: EndpointStats;
    slowestEndpoints: Array<{
        endpoint: string;
        responseTime: number;
        timestamp: string;
    }>;
    trends: any;
    timestamp: string;
}

const router: Router = express.Router();

router.use(RatelimitManager.createApiLimiter());

router.use('/auth', authRouter);

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
router.get('/health', (_req: Request, res: Response) => {
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
router.get('/metrics', (req: Request, res: Response) => {
    const period = (req.query.period as string) || 'hour';

    const metrics = PerformanceManager.getMetrics();

    const now = Date.now();
    let periodMs: number;

    switch (period) {
        case 'hour':
            periodMs = 60 * 60 * 1000;
            break;
        case 'day':
            periodMs = 24 * 60 * 60 * 1000;
            break;
        case 'week':
            periodMs = 7 * 24 * 60 * 60 * 1000;
            break;
        default:
            periodMs = 60 * 60 * 1000;
    }

    const periodStart = now - periodMs;

    const filteredResponseTimes = metrics.responseTimeHistory.filter((entry: any) => entry.timestamp >= periodStart);
    const filteredRequestsPerMinute = metrics.requestsPerMinute.filter((entry: any) => entry.timestamp >= periodStart);

    const totalRequests = filteredRequestsPerMinute.reduce((sum: number, entry: any) => sum + entry.count, 0);
    const totalErrors = filteredRequestsPerMinute.reduce((sum: number, entry: any) => sum + entry.errors, 0);
    const successRate = totalRequests > 0 ? ((totalRequests - totalErrors) / totalRequests * 100) : 100;
    const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100) : 0;
    const avgResponseTime = filteredResponseTimes.length > 0 ? 
        filteredResponseTimes.reduce((sum: number, entry: any) => sum + entry.responseTime, 0) / filteredResponseTimes.length : 0;

    const endpointStats: EndpointStats = {};
    Object.entries(metrics.endpoints)
        .sort((a: any, b: any) => b[1].count - a[1].count)
        .slice(0, 10)
        .forEach(([endpoint, stats]: [string, any]) => {
            endpointStats[endpoint] = {
                count: stats.count,
                avgResponseTime: stats.avgTime.toFixed(2),
                lastUsed: new Date(stats.lastUsed).toISOString()
            };
        });

    const slowestEndpoints = Array.from(metrics.slowestEndpoints.entries())
        .filter(([_endpoint, data]) => data.timestamp >= periodStart)
        .sort((a: any, b: any) => b[1].responseTime - a[1].responseTime)
        .slice(0, 5)
        .map(([endpoint, data]) => ({
            endpoint,
            responseTime: data.responseTime,
            timestamp: new Date(data.timestamp).toISOString()
        }));
    
    const response: MetricsResponse = {
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
            successRate: parseFloat(successRate.toFixed(2)),
            errorRate: parseFloat(errorRate.toFixed(2)),
            perMinute: totalRequests / (periodMs / 60000),
            avgResponseTime: avgResponseTime.toFixed(2)
        },
        statusCodes: metrics.statusCodes,
        topEndpoints: endpointStats,
        slowestEndpoints,
        trends: metrics.trends,
        timestamp: new Date().toISOString()
    };
    
    res.json(response);
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
router.get('/routes', (_req: Request, res: Response) => {
    const routes: ApiRoute[] = [];

    function extractRoutes(router: any, basePath: string = '') {
        if (!router.stack) return;

        router.stack.forEach((layer: any) => {
            if (layer.route) {
                const path = basePath + layer.route.path;
                Object.keys(layer.route.methods).forEach((method: string) => {
                    if (layer.route.methods[method]) {
                        routes.push({
                            path,
                            method: method.toUpperCase(),
                            protected: path.includes('/auth/') || 
                                      path.includes('/users/') || 
                                      (layer.route.stack && 
                                      layer.route.stack.some((s: any) => 
                                        s.name === 'authenticate' || 
                                        s.name === 'authorize'
                                      ))
                        });
                    }
                });
            } else if (layer.name === 'router') {
                let newPath = basePath;
                if (layer.regexp && layer.regexp.fast_slash === false) {
                    const match = layer.regexp.toString().match(/^\/\^((?:\\\/|[^\/])+)/);
                    if (match) {
                        newPath = basePath + match[1].replace(/\\(.)/g, '$1');
                    }
                }
                extractRoutes(layer.handle, newPath);
            }
        });
    }

    extractRoutes(router, '/api/v1');

    extractRoutes(authRouter, '/api/v1/auth');

    extractRoutes(usersRouter, '/api/v1/users');
    
    res.json(routes);
});

export = router;