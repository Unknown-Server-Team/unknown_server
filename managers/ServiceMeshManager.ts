import { EventEmitter } from 'events';
import type { NextFunction, Request, Response } from 'express';
import type {
    MeshServiceConfig,
    ServiceInfo,
    MeshServiceMetrics,
    ServiceDiscoveryRecord,
    RouteConfig,
    ServiceProxy,
    MeshConfig,
    ServiceFilters,
    LoadBalancingEndpoint,
    MeshResponse
} from '../types/serviceMesh';
import type { LogManagerModule, CacheManagerModule } from '../types/modules';
import LogManagerImport from './LogManager';
import CacheManagerImport from './CacheManager';

const LogManager = LogManagerImport as unknown as LogManagerModule;
const CacheManager = CacheManagerImport as unknown as CacheManagerModule;

const MESH_FORWARDED_HEADER = 'x-mesh-forwarded';
const DEFAULT_HEALTH_CHECK_PATH = '/health';
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
    'host',
    'content-length'
]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

class ServiceMeshManager extends EventEmitter {
    private services: Map<string, ServiceInfo>;
    private metrics: Map<string, number[]>;
    private healthChecks: Map<string, NodeJS.Timeout>;
    private proxyRoutes: Map<string, ServiceProxy>;
    private serviceDiscovery: Map<string, ServiceDiscoveryRecord>;
    private config: MeshConfig;

    constructor() {
        super();
        this.services = new Map();
        this.metrics = new Map();
        this.healthChecks = new Map();
        this.proxyRoutes = new Map();
        this.serviceDiscovery = new Map();

        this.config = {
            healthCheckInterval: 10000,
            metricCollectionInterval: 5000,
            retryAttempts: 3,
            loadBalancingStrategy: 'round-robin',
            maxConcurrentRequests: 100,
            autoRecoveryEnabled: true,
            autoRecoveryInterval: 60000,
            failureThreshold: 3
        };

        if (this.config.autoRecoveryEnabled) {
            this._startAutoRecovery();
        }
    }

    registerService(serviceConfig: MeshServiceConfig): ServiceInfo {
        const { name, url, healthCheck, healthCheckPath, version, tags = [], discoverable = true } = serviceConfig;

        const service: ServiceInfo = {
            name,
            url,
            version,
            status: 'registered',
            lastSeen: Date.now(),
            failureCount: 0,
            tags,
            discoverable,
            metrics: {
                requestCount: 0,
                errorCount: 0,
                avgResponseTime: 0,
                p95ResponseTime: 0,
                availabilityPercentage: 100
            } as MeshServiceMetrics,
            healthCheckPath: healthCheckPath || DEFAULT_HEALTH_CHECK_PATH,
            healthCheck: healthCheck || this.defaultHealthCheck.bind(this)
        };

        this.services.set(name, service);
        this.startHealthCheck(name);

        if (discoverable) {
            this.serviceDiscovery.set(name, {
                name,
                url,
                version,
                status: 'registered',
                tags,
                lastUpdate: Date.now()
            });
        }

        this.emit('service:registered', { service });
        LogManager.info('Service registered in mesh', { name, url, healthCheckPath: service.healthCheckPath, version, tags });

        return service;
    }

    private async defaultHealthCheck(service: ServiceInfo): Promise<boolean> {
        try {
            const response = await fetch(new URL(service.healthCheckPath, service.url));
            return response.status === 200;
        } catch (error: unknown) {
            LogManager.debug(`Health check failed for ${service.name}`, error);
            return false;
        }
    }

    private startHealthCheck(serviceName: string): void {
        const interval = setInterval(async () => {
            const service = this.services.get(serviceName);
            if (!service) {
                clearInterval(interval);
                return;
            }

            try {
                const isHealthy = await service.healthCheck(service);
                const previousStatus = service.status;

                if (isHealthy) {
                    service.status = 'healthy';
                    service.failureCount = 0;
                } else {
                    service.failureCount++;
                    if (service.failureCount >= this.config.failureThreshold) {
                        service.status = 'unhealthy';
                    }
                }

                service.lastSeen = Date.now();

                const totalChecks = service.metrics.requestCount + 1;
                service.metrics.availabilityPercentage =
                    ((totalChecks - service.metrics.errorCount) / totalChecks) * 100;

                if (previousStatus !== service.status) {
                    this.emit('service:status', {
                        service: serviceName,
                        status: service.status,
                        previousStatus
                    });

                    if (service.discoverable && this.serviceDiscovery.has(serviceName)) {
                        const discoveryRecord = this.serviceDiscovery.get(serviceName)!;
                        discoveryRecord.status = service.status;
                        discoveryRecord.lastUpdate = Date.now();
                    }

                    LogManager.info(`Service ${serviceName} status changed from ${previousStatus} to ${service.status}`);
                }
            } catch (error: unknown) {
                service.status = 'error';
                service.failureCount++;
                LogManager.error(`Health check failed for ${serviceName}`, error);
            }
        }, this.config.healthCheckInterval);

        this.healthChecks.set(serviceName, interval);
    }

    setupServiceProxy(serviceName: string, routeConfig: RouteConfig): ServiceProxy {
        const proxy: ServiceProxy = {
            target: routeConfig.target,
            routes: routeConfig.routes,
            middleware: routeConfig.middleware || [],
            loadBalancer: this.createLoadBalancer(routeConfig.loadBalancingStrategy),
            timeout: routeConfig.timeout || 30000,
            retryAttempts: routeConfig.retryAttempts || this.config.retryAttempts,
            circuitBreaker: routeConfig.circuitBreaker || false
        };

        this.proxyRoutes.set(serviceName, proxy);
        LogManager.info(`Service proxy setup for ${serviceName}`, {
            target: proxy.target,
            routes: proxy.routes,
            strategy: routeConfig.loadBalancingStrategy || 'round-robin'
        });

        return proxy;
    }

    private createLoadBalancer(strategy: string = 'round-robin'): (endpoints: unknown[]) => unknown {
        let current = 0;
        const strategies: Record<string, (endpoints: unknown[]) => unknown> = {
            'round-robin': (endpoints: unknown[]) => {
                current = (current + 1) % endpoints.length;
                return endpoints[current];
            },
            'least-connections': (endpoints: unknown[]) => {
                return (endpoints as LoadBalancingEndpoint[]).reduce((min, endpoint) =>
                    (endpoint.activeConnections < min.activeConnections) ? endpoint : min
                );
            },
            'random': (endpoints: unknown[]) => {
                return endpoints[Math.floor(Math.random() * endpoints.length)];
            },
            'weighted': (endpoints: unknown[]) => {
                const typed = endpoints as LoadBalancingEndpoint[];
                const validEndpoints = typed.filter(e => (e.weight || 0) > 0);
                if (validEndpoints.length === 0) return typed[0];

                const totalWeight = validEndpoints.reduce((sum, endpoint) => sum + (endpoint.weight || 0), 0);

                let random = Math.random() * totalWeight;
                for (const endpoint of validEndpoints) {
                    random -= endpoint.weight || 0;
                    if (random <= 0) return endpoint;
                }

                return validEndpoints[0];
            }
        };

        return strategies[strategy] || strategies['round-robin'];
    }

    async handleRequest(req: Request, serviceName: string): Promise<MeshResponse> {
        const service = this.services.get(serviceName);
        if (!service) {
            throw new Error(`Service ${serviceName} not found`);
        }

        if (service.status !== 'healthy') {
            const isHealthy = await service.healthCheck(service);
            if (!isHealthy) {
                throw new Error(`Service ${serviceName} is not available`);
            }
            service.status = 'healthy';
            service.failureCount = 0;
        }

        const startTime = Date.now();
        try {
            const proxy = this.proxyRoutes.get(serviceName);
            if (!proxy) {
                throw new Error(`No proxy configuration for ${serviceName}`);
            }

            for (const middleware of proxy.middleware) {
                await middleware(req);
            }

            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Request to ${serviceName} timed out`)),
                    proxy.timeout);
            });

            const requestPromise = this._executeRequestWithRetry(req, proxy);
            const response = await Promise.race([requestPromise, timeoutPromise]);

            const responseTime = Date.now() - startTime;
            this.updateMetrics(serviceName, responseTime, response.status < 500);

            return response;
        } catch (error: unknown) {
            const responseTime = Date.now() - startTime;
            this.updateMetrics(serviceName, responseTime, false);
            LogManager.error(`Service request failed for ${serviceName}`, error);
            throw error;
        }
    }

    private async _executeRequestWithRetry(req: Request, proxy: ServiceProxy): Promise<MeshResponse> {
        const attempts = IDEMPOTENT_METHODS.has(req.method) ? proxy.retryAttempts : 1;
        let lastError!: Error;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                return await this.routeRequest(req, proxy);
            } catch (error: unknown) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < attempts - 1) {
                    await new Promise(resolve =>
                        setTimeout(resolve, Math.pow(2, attempt) * 100));
                }
            }
        }
        throw lastError;
    }

    private buildForwardHeaders(req: Request): Headers {
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
            if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
                continue;
            }
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }

        const remoteAddress = req.socket?.remoteAddress;
        if (remoteAddress) {
            const forwardedFor = headers.get('x-forwarded-for');
            headers.set('x-forwarded-for', forwardedFor ? `${forwardedFor}, ${remoteAddress}` : remoteAddress);
        }
        headers.set(MESH_FORWARDED_HEADER, '1');
        return headers;
    }

    private isCacheable(req: Request): boolean {
        return req.method === 'GET' && !req.headers.authorization && !req.headers.cookie;
    }

    private async routeRequest(req: Request, proxy: ServiceProxy): Promise<MeshResponse> {
        const targetUrl = new URL(req.originalUrl || req.url, proxy.target);
        const cacheKey = `mesh:${targetUrl.origin}:${req.method}:${targetUrl.pathname}${targetUrl.search}`;
        const cacheable = this.isCacheable(req);

        if (cacheable) {
            const cached = await CacheManager.get(cacheKey) as MeshResponse | null;
            if (cached) return cached;
        }

        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const requestInit: RequestInit & { duplex?: 'half' } = {
            method: req.method,
            headers: this.buildForwardHeaders(req),
            redirect: 'manual'
        };
        if (hasBody) {
            requestInit.body = req as unknown as ReadableStream;
            requestInit.duplex = 'half';
        }

        const response = await fetch(targetUrl, requestInit);
        const result: MeshResponse = {
            status: response.status,
            contentType: response.headers.get('content-type'),
            body: await response.text()
        };
        if (response.status >= 500) {
            throw Object.assign(new Error(`Service returned ${response.status}: ${response.statusText}`), { meshResponse: result });
        }

        if (cacheable && response.status === 200) {
            await CacheManager.set(cacheKey, result, 300);
        }

        return result;
    }

    private updateMetrics(serviceName: string, responseTime: number, success: boolean): void {
        const service = this.services.get(serviceName);
        if (!service) return;

        service.metrics.requestCount++;
        if (!success) service.metrics.errorCount++;

        const prevAvg = service.metrics.avgResponseTime;
        const requestCount = service.metrics.requestCount;
        service.metrics.avgResponseTime =
            (prevAvg * (requestCount - 1) + responseTime) / requestCount;

        if (!this.metrics.has(serviceName)) {
            this.metrics.set(serviceName, []);
        }
        const responseTimes = this.metrics.get(serviceName)!;
        responseTimes.push(responseTime);

        if (responseTimes.length > 100) {
            responseTimes.shift();
        }

        if (responseTimes.length > 10) {
            const sortedTimes = [...responseTimes].sort((a, b) => a - b);
            const p95Index = Math.floor(sortedTimes.length * 0.95);
            service.metrics.p95ResponseTime = sortedTimes[p95Index];
        }
    }

    createMeshMiddleware(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
        return async (req, res, next) => {
            if (req.headers[MESH_FORWARDED_HEADER]) {
                return next();
            }

            const serviceName = this.resolveService(req.path);
            if (!serviceName) {
                return next();
            }

            try {
                this.sendMeshResponse(res, await this.handleRequest(req, serviceName));
            } catch (error: unknown) {
                LogManager.error('Service mesh error', error);
                const upstream = (error as { meshResponse?: MeshResponse }).meshResponse;
                if (upstream) {
                    this.sendMeshResponse(res, upstream);
                    return;
                }
                const message = error instanceof Error ? error.message : 'Unknown error';
                res.status(503).json({
                    error: 'Service temporarily unavailable',
                    service: serviceName,
                    message
                });
            }
        };
    }

    private sendMeshResponse(res: Response, result: MeshResponse): void {
        res.status(result.status);
        if (result.contentType) {
            res.type(result.contentType);
        }
        res.send(result.body);
    }

    private resolveService(path: string): string | null {
        for (const [serviceName, proxy] of this.proxyRoutes) {
            if (proxy.routes.some(route => path.startsWith(route))) {
                return serviceName;
            }
        }
        return null;
    }

    getServiceMetrics(): Record<string, unknown> {
        const metrics: Record<string, unknown> = {};
        for (const [name, service] of this.services) {
            metrics[name] = {
                status: service.status,
                metrics: service.metrics,
                lastSeen: service.lastSeen,
                version: service.version,
                tags: service.tags
            };
        }
        return metrics;
    }

    getServicesByTag(tag: string): Array<{ name: string; url: string; status: string; version: string }> {
        const result: Array<{ name: string; url: string; status: string; version: string }> = [];
        for (const [name, service] of this.services) {
            if (service.tags.includes(tag)) {
                result.push({
                    name,
                    url: service.url,
                    status: service.status,
                    version: service.version
                });
            }
        }
        return result;
    }

    discoverServices(filters: ServiceFilters = {}): Array<{ name: string; url: string; version: string; status: string; tags: string[]; lastUpdate: number }> {
        const result: Array<{ name: string; url: string; version: string; status: string; tags: string[]; lastUpdate: number }> = [];
        for (const [, service] of this.serviceDiscovery) {
            if (filters.tag && !service.tags.includes(filters.tag)) continue;
            if (filters.status && service.status !== filters.status) continue;

            result.push({
                name: service.name,
                url: service.url,
                version: service.version,
                status: service.status,
                tags: service.tags,
                lastUpdate: service.lastUpdate
            });
        }
        return result;
    }

    private _startAutoRecovery(): void {
        setInterval(() => {
            this.services.forEach(async (service, name) => {
                if (service.status === 'unhealthy' || service.status === 'error') {
                    LogManager.info(`Attempting to recover service: ${name}`);
                    try {
                        const isHealthy = await service.healthCheck(service);
                        if (isHealthy) {
                            service.status = 'healthy';
                            service.failureCount = 0;

                            if (service.discoverable && this.serviceDiscovery.has(name)) {
                                const discoveryRecord = this.serviceDiscovery.get(name)!;
                                discoveryRecord.status = 'healthy';
                                discoveryRecord.lastUpdate = Date.now();
                            }

                            LogManager.info(`Successfully recovered service: ${name}`);
                            this.emit('service:recovered', { service: name });
                        }
                    } catch (error: unknown) {
                        LogManager.debug(`Recovery attempt failed for ${name}`, error);
                    }
                }
            });
        }, this.config.autoRecoveryInterval);
    }

    unregisterService(serviceName: string): void {
        if (this.healthChecks.has(serviceName)) {
            clearInterval(this.healthChecks.get(serviceName)!);
            this.healthChecks.delete(serviceName);
        }

        this.services.delete(serviceName);
        this.serviceDiscovery.delete(serviceName);
        this.proxyRoutes.delete(serviceName);
        this.metrics.delete(serviceName);

        LogManager.info(`Service ${serviceName} unregistered from mesh`);
        this.emit('service:unregistered', { service: serviceName });
    }
}

const serviceMeshManager = new ServiceMeshManager();

export = serviceMeshManager;
