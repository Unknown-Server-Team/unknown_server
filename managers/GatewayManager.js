const CircuitBreaker = require('opossum');
const { performance } = require('perf_hooks');
const LogManager = require('./LogManager');
const CacheManager = require('./CacheManager');
const PerformanceManager = require('./PerformanceManager');

class GatewayManager {
    constructor() {
        this.services = new Map();
        this.circuitBreakers = new Map();
        this.routeCache = new Map();
        
        // Default circuit breaker options
        this.defaultCircuitBreakerOptions = {
            timeout: 3000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000,
            volumeThreshold: 10
        };
    }

    registerService(name, options = {}) {
        const serviceConfig = {
            name,
            healthCheck: options.healthCheck || (() => Promise.resolve(true)),
            timeout: options.timeout || 5000,
            maxRetries: options.maxRetries || 3,
            endpoints: options.endpoints || [],
            isActive: true,
            ...options
        };

        this.services.set(name, serviceConfig);
        this.createCircuitBreaker(name, options.circuitBreaker);

        LogManager.info(`Service registered: ${name}`, serviceConfig);
        return this;
    }

    createCircuitBreaker(serviceName, options = {}) {
        const service = this.services.get(serviceName);
        if (!service) {
            throw new Error(`Service ${serviceName} not found`);
        }

        const breaker = new CircuitBreaker(async (req) => {
            const startTime = performance.now();
            try {
                // Route the request through the service
                const result = await this.routeRequest(service, req);
                
                // Track performance metrics
                const duration = performance.now() - startTime;
                PerformanceManager.trackRequest(duration, 200, req.path);
                
                return result;
            } catch (error) {
                const duration = performance.now() - startTime;
                PerformanceManager.trackError(error, req.path);
                throw error;
            }
        }, {
            ...this.defaultCircuitBreakerOptions,
            ...options
        });

        // Circuit breaker event handlers
        breaker.on('success', () => {
            LogManager.debug(`Circuit breaker success: ${serviceName}`);
        });

        breaker.on('timeout', () => {
            LogManager.warning(`Circuit breaker timeout: ${serviceName}`);
        });

        breaker.on('failure', () => {
            LogManager.error(`Circuit breaker failure: ${serviceName}`);
        });

        breaker.on('open', () => {
            LogManager.warning(`Circuit breaker opened: ${serviceName}`);
            service.isActive = false;
        });

        breaker.on('close', () => {
            LogManager.info(`Circuit breaker closed: ${serviceName}`);
            service.isActive = true;
        });

        this.circuitBreakers.set(serviceName, breaker);
    }

    async routeRequest(service, req) {
        const cacheKey = `${service.name}:${req.method}:${req.path}`;
        
        // Check cache for GET requests
        if (req.method === 'GET') {
            const cachedResponse = await CacheManager.get(cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }
        }

        // Apply service-specific middleware
        for (const middleware of (service.middleware || [])) {
            await middleware(req);
        }

        // Route the request
        const response = await this.executeRequest(service, req);

        // Cache successful GET responses
        if (req.method === 'GET' && response) {
            await CacheManager.set(cacheKey, response, service.cacheTTL || 300);
        }

        return response;
    }

    async executeRequest(service, req) {
        let lastError;
        for (let attempt = 1; attempt <= service.maxRetries; attempt++) {
            try {
                const endpoint = await this.getHealthyEndpoint(service);
                if (!endpoint) {
                    throw new Error(`No healthy endpoints available for ${service.name}`);
                }

                return await endpoint.handler(req);
            } catch (error) {
                lastError = error;
                LogManager.error(`Request failed for ${service.name}, attempt ${attempt}`, error);
                
                // Wait before retry using exponential backoff
                if (attempt < service.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                }
            }
        }
        throw lastError;
    }

    async getHealthyEndpoint(service) {
        const endpoints = service.endpoints.filter(e => e.isHealthy);
        if (endpoints.length === 0) return null;
        
        // Simple round-robin selection for now
        const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
        return endpoint;
    }

    createGatewayMiddleware() {
        return async (req, res, next) => {
            const serviceName = this.resolveService(req);
            if (!serviceName) {
                return next();
            }

            const breaker = this.circuitBreakers.get(serviceName);
            if (!breaker) {
                return next();
            }

            try {
                const result = await breaker.fire(req);
                res.json(result);
            } catch (error) {
                LogManager.error('Gateway error', error);
                next(error);
            }
        };
    }

    resolveService(req) {
        // Cache route resolution
        const cacheKey = `route:${req.path}`;
        if (this.routeCache.has(cacheKey)) {
            return this.routeCache.get(cacheKey);
        }

        // Find matching service based on path
        for (const [name, service] of this.services) {
            if (service.endpoints.some(e => req.path.startsWith(e.path))) {
                this.routeCache.set(cacheKey, name);
                return name;
            }
        }

        return null;
    }

    getServiceHealth() {
        const health = {};
        for (const [name, service] of this.services) {
            const breaker = this.circuitBreakers.get(name);
            health[name] = {
                isActive: service.isActive,
                circuitBreakerState: breaker ? breaker.stats : null,
                endpoints: service.endpoints.map(e => ({
                    path: e.path,
                    isHealthy: e.isHealthy
                }))
            };
        }
        return health;
    }
}

module.exports = new GatewayManager();