import CircuitBreaker from 'opossum';
import { performance } from 'perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import type {
    GatewayResponse,
    GatewayRequest,
    GatewayHandler,
    ServiceEndpoint,
    ServiceRegistrationOptions,
    ServiceEndpointState,
    ServiceConfig,
    CircuitBreakerOptions,
    CircuitBreakerContext,
    GatewayCircuitBreakerState,
    ServiceHealth,
    GatewayServiceMetrics,
    ServiceMeshManagerModule,
    PerformanceManagerModule
} from '../types/gateway';
import type { LogManagerModule, CacheManagerModule } from '../types/modules';
import LogManagerImport from './LogManager';
import CacheManagerImport from './CacheManager';
import PerformanceManagerImport from './PerformanceManager';
import ServiceMeshManagerImport from './ServiceMeshManager';

const LogManager = LogManagerImport as unknown as LogManagerModule;
const CacheManager = CacheManagerImport as unknown as CacheManagerModule;
const PerformanceManager = PerformanceManagerImport as unknown as PerformanceManagerModule;
const ServiceMeshManager = ServiceMeshManagerImport as unknown as ServiceMeshManagerModule;

class GatewayManager {
    private services: Map<string, ServiceConfig>;
    private circuitBreakers: Map<string, GatewayCircuitBreakerState>;
    private routeCache: Map<string, string>;
    private endpointWeights: Map<string, Map<string, number>>;
    private defaultCircuitBreakerOptions: CircuitBreakerOptions;

    constructor() {
        this.services = new Map();
        this.circuitBreakers = new Map();
        this.routeCache = new Map();
        this.endpointWeights = new Map();
        this.defaultCircuitBreakerOptions = {
            timeout: 3000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000,
            volumeThreshold: 10
        };
        this._startHealthChecks();
        setInterval(() => this.routeCache.clear(), 60000);
    }

    registerService(name: string, options: ServiceRegistrationOptions = {}): this {
        const serviceConfig: ServiceConfig = {
            name,
            healthCheck: options.healthCheck || (() => Promise.resolve(true)),
            timeout: options.timeout || 5000,
            maxRetries: options.maxRetries || 3,
            endpoints: (options.endpoints || []).map((endpoint: ServiceEndpoint) => ({
                ...endpoint,
                isHealthy: true,
                failures: 0,
                lastCheck: Date.now(),
                activeConnections: 0
            })),
            isActive: true,
            cacheTTL: options.cacheTTL || 300,
            middleware: options.middleware || [],
            loadBalancingStrategy: options.loadBalancingStrategy || 'round-robin',
            tags: options.tags || [],
            version: options.version || '1.0.0',
            ...options
        } as ServiceConfig;

        this.services.set(name, serviceConfig);

        if (serviceConfig.loadBalancingStrategy === 'weighted') {
            const weights = new Map<string, number>();
            serviceConfig.endpoints.forEach((endpoint) => {
                weights.set(endpoint.path, endpoint.weight || 1);
            });
            this.endpointWeights.set(name, weights);
        }

        serviceConfig.endpoints.forEach((endpoint) => {
            endpoint.isHealthy = true;
            endpoint.failures = 0;
            endpoint.lastCheck = Date.now();
            endpoint.activeConnections = 0;
        });

        this.createCircuitBreaker(name, options.circuitBreaker);

        if (options.registerWithMesh) {
            try {
                ServiceMeshManager.registerService({
                    name,
                    url: options.meshUrl || `http://localhost:${process.env.PORT || 3000}`,
                    version: serviceConfig.version,
                    tags: serviceConfig.tags,
                    discoverable: true
                });
                LogManager.info(`Service ${name} registered with service mesh`);
            } catch (error: unknown) {
                LogManager.warning(`Failed to register ${name} with service mesh`, error);
            }
        }

        LogManager.info(`Service registered: ${name}`, serviceConfig);
        return this;
    }

    createCircuitBreaker(serviceName: string, options: CircuitBreakerOptions = {}): void {
        const service = this.services.get(serviceName);
        if (!service) {
            throw new Error(`Service ${serviceName} not found`);
        }

        const breaker = new CircuitBreaker(async (req: GatewayRequest) => {
            const startTime = performance.now();
            try {
                const result = await this.routeRequest(service, req);
                const duration = performance.now() - startTime;
                PerformanceManager.trackRequest(duration, 200, req.path);
                return result;
            } catch (error: unknown) {
                const duration = performance.now() - startTime;
                void duration;
                PerformanceManager.trackError(error, req.path);
                throw error;
            }
        }, {
            ...this.defaultCircuitBreakerOptions,
            ...options
        }) as unknown as GatewayCircuitBreakerState & {
            on(event: 'timeout', listener: (_error: unknown, context: CircuitBreakerContext | undefined) => void): void;
            on(event: 'failure', listener: (_error: unknown, context: CircuitBreakerContext | undefined) => void): void;
            on(event: string, listener: (...args: any[]) => void): void;
        };

        breaker.on('success', () => {
            LogManager.debug(`Circuit breaker success: ${serviceName}`);
        });

        breaker.on('timeout', (_error: unknown, context: CircuitBreakerContext | undefined) => {
            LogManager.warning(`Circuit breaker timeout: ${serviceName}`);
            if (context && context.path) {
                this._markServiceEndpoint(serviceName, context.path, false);
            }
        });

        breaker.on('failure', (_error: unknown, context: CircuitBreakerContext | undefined) => {
            LogManager.error(`Circuit breaker failure: ${serviceName}`);
            if (context && context.path) {
                this._markServiceEndpoint(serviceName, context.path, false);
            }
        });

        breaker.on('open', () => {
            LogManager.warning(`Circuit breaker opened: ${serviceName}`);
            service.isActive = false;
        });

        breaker.on('close', () => {
            LogManager.info(`Circuit breaker closed: ${serviceName}`);
            service.isActive = true;
        });

        breaker.on('halfOpen', () => {
            LogManager.info(`Circuit breaker half-open: ${serviceName}`);
        });

        breaker.on('fallback', () => {
            LogManager.warning(`Circuit breaker fallback: ${serviceName}`);
        });

        this.circuitBreakers.set(serviceName, breaker);
    }

    async routeRequest(service: ServiceConfig, req: GatewayRequest): Promise<GatewayResponse> {
        const cacheKey = `${service.name}:${req.method}:${req.path}`;

        if (req.method === 'GET') {
            const cachedResponse = await CacheManager.get(cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }
        }

        for (const middleware of service.middleware) {
            await middleware(req);
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Request timed out for ${service.name}`)), service.timeout);
        });

        const requestPromise = this.executeRequest(service, req);
        const response = await Promise.race<GatewayResponse | never>([requestPromise, timeoutPromise]);

        if (req.method === 'GET' && response) {
            await CacheManager.set(cacheKey, response, service.cacheTTL);
        }

        return response;
    }

    async executeRequest(service: ServiceConfig, req: GatewayRequest): Promise<GatewayResponse> {
        let lastError: unknown = new Error(`No healthy endpoints available for ${service.name}`);
        const startAttempt = Date.now();

        for (let attempt = 1; attempt <= service.maxRetries; attempt++) {
            try {
                const endpoint = await this.getHealthyEndpoint(service);
                if (!endpoint) {
                    throw new Error(`No healthy endpoints available for ${service.name}`);
                }

                endpoint.activeConnections++;

                try {
                    const result = await endpoint.handler(req);
                    this._markServiceEndpoint(service.name, endpoint.path, true);
                    endpoint.activeConnections = Math.max(0, endpoint.activeConnections - 1);
                    return result;
                } catch (error: unknown) {
                    endpoint.activeConnections = Math.max(0, endpoint.activeConnections - 1);
                    this._markServiceEndpoint(service.name, endpoint.path, false);
                    throw error;
                }
            } catch (error: unknown) {
                lastError = error;
                LogManager.error(`Request failed for ${service.name}, attempt ${attempt}/${service.maxRetries}`, error);

                if (attempt < service.maxRetries) {
                    const backoff = Math.pow(2, attempt) * 100;
                    const jitter = Math.random() * 100;
                    await new Promise<void>((resolve) => setTimeout(resolve, backoff + jitter));
                }
            }
        }

        const totalTime = Date.now() - startAttempt;
        LogManager.warning(`All ${service.maxRetries} retry attempts failed for ${service.name} after ${totalTime}ms`);
        throw lastError;
    }

    async getHealthyEndpoint(service: ServiceConfig): Promise<ServiceEndpointState | null> {
        const endpoints = service.endpoints.filter((endpoint) => endpoint.isHealthy);

        if (endpoints.length === 0) {
            LogManager.warning(`No healthy endpoints for ${service.name}, trying all endpoints`);
            if (service.endpoints.length === 0) {
                return null;
            }
            return service.endpoints[Math.floor(Math.random() * service.endpoints.length)];
        }

        switch (service.loadBalancingStrategy) {
            case 'round-robin':
                service._lastEndpointIndex = (service._lastEndpointIndex || 0) + 1;
                return endpoints[service._lastEndpointIndex % endpoints.length];
            case 'least-connections':
                return endpoints.reduce((min, endpoint) => (
                    endpoint.activeConnections < min.activeConnections ? endpoint : min
                ), endpoints[0]);
            case 'weighted': {
                const weights = this.endpointWeights.get(service.name) || new Map<string, number>();
                const totalWeight = endpoints.reduce((sum, endpoint) => sum + (weights.get(endpoint.path) || 1), 0);
                let random = Math.random() * totalWeight;
                for (const endpoint of endpoints) {
                    const weight = weights.get(endpoint.path) || 1;
                    random -= weight;
                    if (random <= 0) {
                        return endpoint;
                    }
                }
                return endpoints[0];
            }
            default:
                return endpoints[Math.floor(Math.random() * endpoints.length)];
        }
    }

    createGatewayMiddleware(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            const gatewayReq = req as GatewayRequest;
            const serviceName = this.resolveService(gatewayReq);
            if (!serviceName) {
                next();
                return;
            }

            const breaker = this.circuitBreakers.get(serviceName);
            if (!breaker) {
                next();
                return;
            }

            const service = this.services.get(serviceName);
            const hasExpressStyleHandler = (service?.endpoints || []).some((endpoint) => typeof endpoint.handler === 'function' && endpoint.handler.length >= 2);
            if (hasExpressStyleHandler) {
                next();
                return;
            }

            try {
                gatewayReq.headers = gatewayReq.headers || {};
                gatewayReq.headers['x-gateway-request-id'] = crypto.randomBytes(8).toString('hex');
                gatewayReq.headers['x-gateway-timestamp'] = Date.now().toString();

                const result = await breaker.fire(gatewayReq);
                res.json(result);
            } catch (error: unknown) {
                LogManager.error('Gateway error', error);
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes('timeout')) {
                    res.status(504).json({ error: 'Gateway Timeout', message });
                } else if (message.includes('circuit breaker')) {
                    res.status(503).json({ error: 'Service Unavailable', message: 'Circuit breaker is open' });
                } else if (message.includes('No healthy endpoints')) {
                    res.status(503).json({ error: 'Service Unavailable', message: 'No healthy endpoints available' });
                } else {
                    res.status(502).json({ error: 'Bad Gateway', message });
                }
            }
        };
    }

    resolveService(req: Pick<GatewayRequest, 'path'>): string | null {
        const cacheKey = `route:${req.path}`;
        if (this.routeCache.has(cacheKey)) {
            return this.routeCache.get(cacheKey) || null;
        }

        for (const [name, service] of this.services) {
            if (service.endpoints.some((endpoint) => req.path.startsWith(endpoint.path))) {
                this.routeCache.set(cacheKey, name);
                return name;
            }
        }

        return null;
    }

    getServiceHealth(): Record<string, ServiceHealth> {
        const health: Record<string, ServiceHealth> = {};
        for (const [name, service] of this.services) {
            const breaker = this.circuitBreakers.get(name);
            const healthyEndpoints = service.endpoints.filter((endpoint) => endpoint.isHealthy).length;
            const healthPercentage = service.endpoints.length > 0
                ? (healthyEndpoints / service.endpoints.length) * 100
                : 0;

            health[name] = {
                isActive: service.isActive,
                healthPercentage,
                circuitBreakerState: breaker ? {
                    state: breaker.status.state ?? 'unknown',
                    stats: {
                        successful: breaker.stats.successes,
                        failed: breaker.stats.failures,
                        rejected: breaker.stats.rejects,
                        timeout: breaker.stats.timeouts
                    }
                } : null,
                endpoints: service.endpoints.map((endpoint) => ({
                    path: endpoint.path,
                    isHealthy: endpoint.isHealthy,
                    failures: endpoint.failures,
                    lastCheck: endpoint.lastCheck,
                    activeConnections: endpoint.activeConnections
                }))
            };
        }
        return health;
    }

    private _markServiceEndpoint(serviceName: string, path: string, isHealthy: boolean): void {
        const service = this.services.get(serviceName);
        if (!service) {
            return;
        }

        const endpoint = service.endpoints.find((candidate) => path.startsWith(candidate.path));
        if (!endpoint) {
            return;
        }

        endpoint.lastCheck = Date.now();

        if (isHealthy) {
            endpoint.failures = 0;
            endpoint.isHealthy = true;
        } else {
            endpoint.failures++;
            if (endpoint.failures >= 3) {
                endpoint.isHealthy = false;
            }
        }
    }

    private _startHealthChecks(): void {
        setInterval(async () => {
            for (const [serviceName, service] of this.services) {
                for (const endpoint of service.endpoints) {
                    try {
                        if (Date.now() - endpoint.lastCheck < 10000) {
                            continue;
                        }

                        if (typeof service.healthCheck === 'function') {
                            const isHealthy = await service.healthCheck();
                            endpoint.isHealthy = isHealthy;
                            LogManager.debug(`Service-level health check for ${serviceName} endpoint ${endpoint.path}: ${isHealthy ? 'healthy' : 'unhealthy'}`);
                        } else if (typeof endpoint.healthCheck === 'function') {
                            const isHealthy = await endpoint.healthCheck();
                            endpoint.isHealthy = isHealthy;
                            LogManager.debug(`Endpoint-specific health check for ${serviceName} endpoint ${endpoint.path}: ${isHealthy ? 'healthy' : 'unhealthy'}`);
                        } else if (endpoint.handler && typeof (endpoint.handler as GatewayHandler).get === 'function') {
                            LogManager.debug(`Using handler GET method for health check on ${serviceName} endpoint ${endpoint.path}`);
                            endpoint.isHealthy = true;
                        } else {
                            endpoint.isHealthy = true;
                            LogManager.debug(`No health check method available for ${serviceName} endpoint ${endpoint.path}, marking as healthy by default`);
                        }
                        endpoint.failures = 0;
                        endpoint.lastCheck = Date.now();
                    } catch (error: unknown) {
                        LogManager.debug(`Health check failed for ${serviceName} endpoint ${endpoint.path}`, error);
                        endpoint.failures++;
                        if (endpoint.failures >= 3) {
                            endpoint.isHealthy = false;
                        }
                    }
                }

                const allUnhealthy = service.endpoints.length > 0
                    && service.endpoints.every((endpoint) => !endpoint.isHealthy);

                if (allUnhealthy && service.isActive) {
                    service.isActive = false;
                    LogManager.warning(`All endpoints for ${serviceName} are unhealthy, marking service as inactive`);
                } else if (!allUnhealthy && !service.isActive) {
                    service.isActive = true;
                    LogManager.info(`Service ${serviceName} recovered, marking as active`);
                }
            }
        }, 30000);
    }

    updateEndpointWeights(serviceName: string, weights: Record<string, number>): void {
        if (!this.services.has(serviceName)) {
            throw new Error(`Service ${serviceName} not found`);
        }

        const weightMap = new Map<string, number>();
        for (const [path, weight] of Object.entries(weights)) {
            weightMap.set(path, weight);
        }

        this.endpointWeights.set(serviceName, weightMap);
        LogManager.info(`Updated weights for ${serviceName}`, weights);
    }

    resetCircuitBreaker(serviceName: string): void {
        const breaker = this.circuitBreakers.get(serviceName);
        if (!breaker) {
            throw new Error(`Circuit breaker for ${serviceName} not found`);
        }

        breaker.close();
        LogManager.info(`Circuit breaker for ${serviceName} manually reset`);
    }

    getMetrics(): Record<string, GatewayServiceMetrics> {
        const metrics: Record<string, GatewayServiceMetrics> = {};
        for (const [name, service] of this.services) {
            const breaker = this.circuitBreakers.get(name);
            if (!breaker) {
                continue;
            }

            metrics[name] = {
                success: breaker.stats.successes,
                failure: breaker.stats.failures,
                timeout: breaker.stats.timeouts,
                rejected: breaker.stats.rejects,
                fallback: breaker.stats.fallbacks,
                circuitState: breaker.status.state ?? 'unknown',
                healthyEndpoints: service.endpoints.filter((endpoint) => endpoint.isHealthy).length,
                totalEndpoints: service.endpoints.length
            };
        }
        return metrics;
    }
}

type GatewayManagerExport = GatewayManager & {
    gatewayManager: GatewayManager;
    default: GatewayManager;
};

const gatewayManager = new GatewayManager();
const exportedGatewayManager = gatewayManager as GatewayManagerExport;
exportedGatewayManager.gatewayManager = gatewayManager;
exportedGatewayManager.default = gatewayManager;

export = exportedGatewayManager;
