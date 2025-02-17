const EventEmitter = require('events');
const WebSocket = require('ws');
const LogManager = require('./LogManager');
const PerformanceManager = require('./PerformanceManager');
const CacheManager = require('./CacheManager');

class ServiceMeshManager extends EventEmitter {
    constructor() {
        super();
        this.services = new Map();
        this.metrics = new Map();
        this.healthChecks = new Map();
        this.proxyRoutes = new Map();
        
        // Mesh configuration
        this.config = {
            healthCheckInterval: 10000,
            metricCollectionInterval: 5000,
            retryAttempts: 3,
            loadBalancingStrategy: 'round-robin',
            maxConcurrentRequests: 100
        };
    }

    registerService(serviceConfig) {
        const { name, url, healthCheck, version } = serviceConfig;
        
        const service = {
            name,
            url,
            version,
            status: 'registered',
            lastSeen: Date.now(),
            metrics: {
                requestCount: 0,
                errorCount: 0,
                avgResponseTime: 0
            },
            healthCheck: healthCheck || this.defaultHealthCheck
        };

        this.services.set(name, service);
        this.startHealthCheck(name);
        this.emit('service:registered', { service });
        
        LogManager.info('Service registered in mesh', { name, url, version });
    }

    async defaultHealthCheck(service) {
        try {
            const response = await fetch(`${service.url}/health`);
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    startHealthCheck(serviceName) {
        const interval = setInterval(async () => {
            const service = this.services.get(serviceName);
            if (!service) {
                clearInterval(interval);
                return;
            }

            try {
                const isHealthy = await service.healthCheck(service);
                const previousStatus = service.status;
                service.status = isHealthy ? 'healthy' : 'unhealthy';
                service.lastSeen = Date.now();

                if (previousStatus !== service.status) {
                    this.emit('service:status', {
                        service: serviceName,
                        status: service.status
                    });
                }
            } catch (error) {
                service.status = 'error';
                LogManager.error(`Health check failed for ${serviceName}`, error);
            }
        }, this.config.healthCheckInterval);

        this.healthChecks.set(serviceName, interval);
    }

    setupServiceProxy(serviceName, routeConfig) {
        const proxy = {
            target: routeConfig.target,
            routes: routeConfig.routes,
            middleware: routeConfig.middleware || [],
            loadBalancer: this.createLoadBalancer(routeConfig.loadBalancingStrategy)
        };

        this.proxyRoutes.set(serviceName, proxy);
    }

    createLoadBalancer(strategy = 'round-robin') {
        let current = 0;
        const strategies = {
            'round-robin': (endpoints) => {
                current = (current + 1) % endpoints.length;
                return endpoints[current];
            },
            'least-connections': (endpoints) => {
                return endpoints.reduce((min, endpoint) => 
                    (endpoint.activeConnections < min.activeConnections) ? endpoint : min
                );
            },
            'random': (endpoints) => {
                return endpoints[Math.floor(Math.random() * endpoints.length)];
            }
        };
        
        return strategies[strategy] || strategies['round-robin'];
    }

    async handleRequest(req, serviceName) {
        const service = this.services.get(serviceName);
        if (!service || service.status !== 'healthy') {
            throw new Error(`Service ${serviceName} is not available`);
        }

        const startTime = Date.now();
        try {
            const proxy = this.proxyRoutes.get(serviceName);
            if (!proxy) {
                throw new Error(`No proxy configuration for ${serviceName}`);
            }

            // Apply middleware
            for (const middleware of proxy.middleware) {
                await middleware(req);
            }

            // Route the request
            const response = await this.routeRequest(req, proxy);
            
            // Update metrics
            this.updateMetrics(serviceName, Date.now() - startTime, true);
            
            return response;
        } catch (error) {
            this.updateMetrics(serviceName, Date.now() - startTime, false);
            throw error;
        }
    }

    async routeRequest(req, proxy) {
        const endpoint = proxy.loadBalancer(proxy.routes);
        const cacheKey = `mesh:${req.method}:${req.path}`;

        // Check cache for GET requests
        if (req.method === 'GET') {
            const cached = await CacheManager.get(cacheKey);
            if (cached) return cached;
        }

        // Make the request
        const response = await fetch(`${endpoint}${req.path}`, {
            method: req.method,
            headers: req.headers,
            body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
        });

        // Cache successful GET responses
        if (req.method === 'GET' && response.ok) {
            const data = await response.json();
            await CacheManager.set(cacheKey, data, 300);
            return data;
        }

        return response.json();
    }

    updateMetrics(serviceName, responseTime, success) {
        const service = this.services.get(serviceName);
        if (!service) return;

        service.metrics.requestCount++;
        if (!success) service.metrics.errorCount++;
        
        // Update average response time
        const prevAvg = service.metrics.avgResponseTime;
        const requestCount = service.metrics.requestCount;
        service.metrics.avgResponseTime = 
            (prevAvg * (requestCount - 1) + responseTime) / requestCount;
            
        PerformanceManager.trackServiceMetrics(serviceName, {
            responseTime,
            success,
            timestamp: Date.now()
        });
    }

    createMeshMiddleware() {
        return async (req, res, next) => {
            const serviceName = this.resolveService(req.path);
            if (!serviceName) {
                return next();
            }

            try {
                const result = await this.handleRequest(req, serviceName);
                res.json(result);
            } catch (error) {
                LogManager.error('Service mesh error', error);
                next(error);
            }
        };
    }

    resolveService(path) {
        for (const [serviceName, proxy] of this.proxyRoutes) {
            if (proxy.routes.some(route => path.startsWith(route))) {
                return serviceName;
            }
        }
        return null;
    }

    getServiceMetrics() {
        const metrics = {};
        for (const [name, service] of this.services) {
            metrics[name] = {
                status: service.status,
                metrics: service.metrics,
                lastSeen: service.lastSeen
            };
        }
        return metrics;
    }
}

module.exports = new ServiceMeshManager();