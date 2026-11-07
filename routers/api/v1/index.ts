import express, { Request, Response, Router } from 'express';
import os from 'os';
import { RatelimitManager } from '../../../managers/RatelimitManager';
import authRouter from './auth';
import usersRouter from './users';
import rolesRouter from './roles';
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

router.use('/auth', rolesRouter);

router.use('/users', usersRouter);

router.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        version: 'v1',
        timestamp: new Date().toISOString()
    });
});

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

interface RouteLayer {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ name: string }>;
    };
    name: string;
    regexp?: RegExp;
    handle: { stack?: RouteLayer[] };
}

const mountPathOf = (layer: RouteLayer): string => {
    const match = /^\^((?:\\\/[^\\?(]+)+)\\\/\?\(\?=/.exec(layer.regexp?.source ?? '');
    return match ? match[1].replace(/\\\//g, '/') : '';
};

const joinPath = (basePath: string, routePath: string): string => (
    routePath === '/' ? basePath || '/' : `${basePath}${routePath}`
);

const collectRoutes = (stack: RouteLayer[], basePath: string, routes: ApiRoute[]): void => {
    stack.forEach((layer: RouteLayer) => {
        if (layer.route) {
            const path = joinPath(basePath, layer.route.path);
            const isProtected = layer.route.stack.some((handler) => handler.name === 'authenticate');
            Object.keys(layer.route.methods)
                .filter((method: string) => layer.route?.methods[method])
                .forEach((method: string) => {
                    routes.push({ path, method: method.toUpperCase(), protected: isProtected });
                });
        } else if (layer.name === 'router' && layer.handle.stack) {
            collectRoutes(layer.handle.stack, basePath + mountPathOf(layer), routes);
        }
    });
};

router.get('/routes', (_req: Request, res: Response) => {
    const routes: ApiRoute[] = [];
    collectRoutes((router as unknown as { stack: RouteLayer[] }).stack, '/api/v1', routes);
    res.json(routes);
});

export = router;