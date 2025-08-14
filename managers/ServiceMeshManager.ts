import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { LogManager } from './LogManager';
import { PerformanceManager } from './PerformanceManager';
import { CacheManager } from './CacheManager';
import { Request } from 'express';
import fetch from 'node-fetch';

interface ServiceConfig {
    name: string;
    url: string;
    healthCheck?: (service: ServiceInfo) => Promise<boolean>;
    version: string;
    tags?: string[];
    discoverable?: boolean;
}

interface ServiceInfo {
    name: string;
    url: string;
    version: string;
    status: 'registered' | 'healthy' | 'unhealthy' | 'error';
    lastSeen: number;
    failureCount: number;
    tags: string[];
    discoverable: boolean;
    metrics: ServiceMetrics;
    healthCheck: (service: ServiceInfo) => Promise<boolean>;
}

interface ServiceMetrics {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    availabilityPercentage: number;
}

interface ServiceDiscoveryRecord {
    name: string;
    url: string;
    version: string;
    status: string;
    tags: string[];
    lastUpdate: number;
}

interface RouteConfig {
    target: string;
    routes: string[];
    middleware?: Array<(req: any) => Promise<void>>;
    loadBalancingStrategy?: string;
    timeout?: number;
    retryAttempts?: number;
    circuitBreaker?: boolean;
}

interface ServiceProxy {
    target: string;
    routes: string[];
    middleware: Array<(req: any) => Promise<void>>;
    loadBalancer: (endpoints: any[]) => any;
    timeout: number;
    retryAttempts: number;
    circuitBreaker: boolean;
}

interface MeshConfig {
    healthCheckInterval: number;
    metricCollectionInterval: number;
    retryAttempts: number;
    loadBalancingStrategy: string;
    maxConcurrentRequests: number;
    autoRecoveryEnabled: boolean;
    autoRecoveryInterval: number;
    failureThreshold: number;
}

interface ServiceFilters {
    tag?: string;
    status?: string;
}

interface LoadBalancingEndpoint {
    weight?: number;
    activeConnections: number;
}

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
        this.serviceDiscovery = new Map(); // New service discovery map
        
        // Mesh configuration
        this.config = {
            healthCheckInterval: 10000,
            metricCollectionInterval: 5000,
            retryAttempts: 3,
            loadBalancingStrategy: 'round-robin',
            maxConcurrentRequests: 100,
            autoRecoveryEnabled: true,
            autoRecoveryInterval: 60000, // 1 minute
            failureThreshold: 3, // Number of failures before marking service as unhealthy
        };
        
        // Start automatic recovery if enabled
        if (this.config.autoRecoveryEnabled) {
            this._startAutoRecovery();
        }
    }

    registerService(serviceConfig: ServiceConfig): ServiceInfo {
        const { name, url, healthCheck, version, tags = [], discoverable = true } = serviceConfig;
        
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
            },
            healthCheck: healthCheck || this.defaultHealthCheck
        };

        this.services.set(name, service);
        this.startHealthCheck(name);
        
        // Add to service discovery if discoverable
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
        LogManager.info('Service registered in mesh', { name, url, version, tags });
        
        return service;
    }

    private async defaultHealthCheck(service: ServiceInfo): Promise<boolean> {
        try {
            const response = await fetch(`${service.url}/health`);
            return response.status === 200;
        } catch (error) {
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

                // Update availability percentage
                const totalChecks = service.metrics.requestCount + 1;
                service.metrics.availabilityPercentage = 
                    ((totalChecks - service.metrics.errorCount) / totalChecks) * 100;

                if (previousStatus !== service.status) {
                    this.emit('service:status', {
                        service: serviceName,
                        status: service.status,
                        previousStatus
                    });
                    
                    // Update service discovery status
                    if (service.discoverable && this.serviceDiscovery.has(serviceName)) {
                        const discoveryRecord = this.serviceDiscovery.get(serviceName)!;
                        discoveryRecord.status = service.status;
                        discoveryRecord.lastUpdate = Date.now();
                    }
                    
                    LogManager.info(`Service ${serviceName} status changed from ${previousStatus} to ${service.status}`);
                }
            } catch (error) {
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

    private createLoadBalancer(strategy: string = 'round-robin'): (endpoints: any[]) => any {
        let current = 0;
        const strategies: Record<string, (endpoints: any[]) => any> = {
            'round-robin': (endpoints: any[]) => {
                current = (current + 1) % endpoints.length;
                return endpoints[current];
            },
            'least-connections': (endpoints: LoadBalancingEndpoint[]) => {
                return endpoints.reduce((min, endpoint) => 
                    (endpoint.activeConnections < min.activeConnections) ? endpoint : min
                );
            },
            'random': (endpoints: any[]) => {
                return endpoints[Math.floor(Math.random() * endpoints.length)];
            },
            'weighted': (endpoints: LoadBalancingEndpoint[]) => {
                // Filter out endpoints with zero weight
                const validEndpoints = endpoints.filter(e => (e.weight || 0) > 0);
                if (validEndpoints.length === 0) return endpoints[0];
                
                // Calculate total weight
                const totalWeight = validEndpoints.reduce((sum, endpoint) => sum + (endpoint.weight || 0), 0);
                
                // Select endpoint based on weight
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

    async handleRequest(req: Request, serviceName: string): Promise<any> {
        const service = this.services.get(serviceName);
        if (!service) {
            throw new Error(`Service ${serviceName} not found`);
        }
        
        if (service.status !== 'healthy') {
            // Try one more health check before failing
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

            // Apply middleware
            for (const middleware of proxy.middleware) {
                await middleware(req);
            }

            // Route the request with timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Request to ${serviceName} timed out`)), 
                    proxy.timeout);
            });
            
            const requestPromise = this._executeRequestWithRetry(req, proxy);
            const response = await Promise.race([requestPromise, timeoutPromise]);
            
            // Update metrics
            const responseTime = Date.now() - startTime;
            this.updateMetrics(serviceName, responseTime, true);
            
            return response;
        } catch (error) {
            const responseTime = Date.now() - startTime;
            this.updateMetrics(serviceName, responseTime, false);
            
            LogManager.error(`Service request failed for ${serviceName}`, { 
                path: req.path, 
                error: (error as Error).message 
            });
            
            throw error;
        }
    }
    
    private async _executeRequestWithRetry(req: Request, proxy: ServiceProxy): Promise<any> {
        let lastError: Error;
        for (let attempt = 0; attempt < proxy.retryAttempts; attempt++) {
            try {
                return await this.routeRequest(req, proxy);
            } catch (error: any) {
                lastError = error;
                // Wait with exponential backoff before retrying
                if (attempt < proxy.retryAttempts - 1) {
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.pow(2, attempt) * 100));
                }
            }
        }
        throw lastError!;
    }

    private async routeRequest(req: Request, proxy: ServiceProxy): Promise<any> {
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
            headers: req.headers as any,
            body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
        });

        if (!response.ok) {
            throw new Error(`Service returned ${response.status}: ${response.statusText}`);
        }

        // Cache successful GET responses
        if (req.method === 'GET') {
            const data = await response.json();
            await CacheManager.set(cacheKey, data, 300);
            return data;
        }

        return response.json();
    }

    private updateMetrics(serviceName: string, responseTime: number, success: boolean): void {
        const service = this.services.get(serviceName);
        if (!service) return;

        service.metrics.requestCount++;
        if (!success) service.metrics.errorCount++;
        
        // Update average response time
        const prevAvg = service.metrics.avgResponseTime;
        const requestCount = service.metrics.requestCount;
        service.metrics.avgResponseTime = 
            (prevAvg * (requestCount - 1) + responseTime) / requestCount;
        
        // Store response times for p95 calculation
        if (!this.metrics.has(serviceName)) {
            this.metrics.set(serviceName, []);
        }
        const responseTimes = this.metrics.get(serviceName)!;
        responseTimes.push(responseTime);
        
        // Keep only last 100 response times for memory efficiency
        if (responseTimes.length > 100) {
            responseTimes.shift();
        }
        
        // Calculate p95 response time
        if (responseTimes.length > 10) {
            const sortedTimes = [...responseTimes].sort((a, b) => a - b);
            const p95Index = Math.floor(sortedTimes.length * 0.95);
            service.metrics.p95ResponseTime = sortedTimes[p95Index];
        }
            
        PerformanceManager.trackServiceMetrics(serviceName, {
            responseTime,
            success,
            timestamp: Date.now(),
            p95: service.metrics.p95ResponseTime
        });
    }

    createMeshMiddleware() {
        return async (req: Request, res: any, next: any) => {
            const serviceName = this.resolveService(req.path);
            if (!serviceName) {
                return next();
            }

            try {
                const result = await this.handleRequest(req, serviceName);
                res.json(result);
            } catch (error: any) {
                LogManager.error('Service mesh error', error);
                res.status(503).json({ 
                    error: 'Service temporarily unavailable',
                    service: serviceName,
                    message: error.message
                });
            }
        };
    }

    private resolveService(path: string): string | null {
        for (const [serviceName, proxy] of this.proxyRoutes) {
            if (proxy.routes.some(route => path.startsWith(route))) {
                return serviceName;
            }
        }
        return null;
    }

    getServiceMetrics(): Record<string, any> {
        const metrics: Record<string, any> = {};
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
    
    // Get services by tags
    getServicesByTag(tag: string): any[] {
        const result: any[] = [];
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
    
    // Discover services
    discoverServices(filters: ServiceFilters = {}): any[] {
        const result: any[] = [];
        for (const [name, service] of this.serviceDiscovery) {
            // Apply filters if provided
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
    
    // Attempt to recover services automatically
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
                            
                            // Update service discovery
                            if (service.discoverable && this.serviceDiscovery.has(name)) {
                                const discoveryRecord = this.serviceDiscovery.get(name)!;
                                discoveryRecord.status = 'healthy';
                                discoveryRecord.lastUpdate = Date.now();
                            }
                            
                            LogManager.info(`Successfully recovered service: ${name}`);
                            this.emit('service:recovered', { service: name });
                        }
                    } catch (error) {
                        LogManager.debug(`Recovery attempt failed for ${name}`, error);
                    }
                }
            });
        }, this.config.autoRecoveryInterval);
    }
    
    // Unregister a service
    unregisterService(serviceName: string): void {
        // Clear health checks
        if (this.healthChecks.has(serviceName)) {
            clearInterval(this.healthChecks.get(serviceName)!);
            this.healthChecks.delete(serviceName);
        }
        
        // Remove from maps
        this.services.delete(serviceName);
        this.serviceDiscovery.delete(serviceName);
        this.proxyRoutes.delete(serviceName);
        this.metrics.delete(serviceName);
        
        LogManager.info(`Service ${serviceName} unregistered from mesh`);
        this.emit('service:unregistered', { service: serviceName });
    }
}

export const serviceMeshManager = new ServiceMeshManager();
export default serviceMeshManager;