import CircuitBreaker from 'opossum';
import { performance } from 'perf_hooks';
import { LogManager } from './LogManager';
import { CacheManager } from './CacheManager';
import { PerformanceManager } from './PerformanceManager';
import { ServiceMeshManager } from './ServiceMeshManager';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface ServiceEndpoint {
    path: string;
    handler: any;
    weight?: number;
    isHealthy: boolean;
    failures: number;
    lastCheck: number;
    activeConnections: number;
    healthCheck?: () => Promise<boolean>;
}

interface ServiceConfig {
    name: string;
    healthCheck?: () => Promise<boolean>;
    timeout: number;
    maxRetries: number;
    endpoints: ServiceEndpoint[];
    isActive: boolean;
    cacheTTL: number;
    middleware: Array<(req: any) => Promise<void>>;
    loadBalancingStrategy: 'round-robin' | 'least-connections' | 'weighted';
    tags: string[];
    version: string;
    _lastEndpointIndex?: number;
}

interface ServiceRegistrationOptions {
    healthCheck?: () => Promise<boolean>;
    timeout?: number;
    maxRetries?: number;
    endpoints?: ServiceEndpoint[];
    cacheTTL?: number;
    middleware?: Array<(req: any) => Promise<void>>;
    loadBalancingStrategy?: 'round-robin' | 'least-connections' | 'weighted';
    tags?: string[];
    version?: string;
    circuitBreaker?: any;
    registerWithMesh?: boolean;
    meshUrl?: string;
}

interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    volumeThreshold?: number;
}

interface ServiceHealth {
    isActive: boolean;
    healthPercentage: number;
    circuitBreakerState: {
        state: string;
        stats: {
            successful: number;
            failed: number;
            rejected: number;
            timeout: number;
        };
    } | null;
    endpoints: Array<{
        path: string;
        isHealthy: boolean;
        failures: number;
        lastCheck: number;
        activeConnections: number;
    }>;
}

interface ServiceMetrics {
    success: number;
    failure: number;
    timeout: number;
    rejected: number;
    fallback: number;
    circuitState: string;
    healthyEndpoints: number;
    totalEndpoints: number;
}

class GatewayManager {
    private services: Map<string, ServiceConfig>;
    private circuitBreakers: Map<string, CircuitBreaker>;
    private routeCache: Map<string, string>;
    private healthStatus: Map<string, any>;
    private endpointWeights: Map<string, Map<string, number>>;
    private defaultCircuitBreakerOptions: CircuitBreakerOptions;

    constructor() {
        this.services = new Map();
        this.circuitBreakers = new Map();
        this.routeCache = new Map();
        this.healthStatus = new Map();
        this.endpointWeights = new Map();
        
        // Default circuit breaker options
        this.defaultCircuitBreakerOptions = {
            timeout: 3000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000,
            volumeThreshold: 10
        };
        
        // Start periodic health checks
        this._startHealthChecks();
        
        // Clean route cache periodically
        setInterval(() => this.routeCache.clear(), 60000); // Clear every minute
    }

    registerService(name: string, options: ServiceRegistrationOptions = {}): this {
        const serviceConfig: ServiceConfig = {
            name,
            healthCheck: options.healthCheck || (() => Promise.resolve(true)),
            timeout: options.timeout || 5000,
            maxRetries: options.maxRetries || 3,
            endpoints: options.endpoints || [],
            isActive: true,
            cacheTTL: options.cacheTTL || 300,
            middleware: options.middleware || [],
            loadBalancingStrategy: options.loadBalancingStrategy || 'round-robin',
            tags: options.tags || [],
            version: options.version || '1.0.0'
        };

        this.services.set(name, serviceConfig);
        
        // Initialize endpoint weights for load balancing
        if (serviceConfig.loadBalancingStrategy === 'weighted') {
            const weights = new Map<string, number>();
            serviceConfig.endpoints.forEach(endpoint => {
                weights.set(endpoint.path, endpoint.weight || 1);
            });
            this.endpointWeights.set(name, weights);
        }
        
        // Initialize health status for each endpoint
        serviceConfig.endpoints.forEach(endpoint => {
            endpoint.isHealthy = true;
            endpoint.failures = 0;
            endpoint.lastCheck = Date.now();
            endpoint.activeConnections = 0;
        });

        this.createCircuitBreaker(name, options.circuitBreaker);

        // Register with service mesh if enabled
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
            } catch (error) {
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

        const breaker = new CircuitBreaker(async (req: any) => {
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

        breaker.on('timeout', (err: any, context: any) => {
            LogManager.warning(`Circuit breaker timeout: ${serviceName}`);
            // Only mark endpoint unhealthy if we have path context
            if (context && context.path) {
                this._markServiceEndpoint(serviceName, context.path, false);
            }
        });

        breaker.on('failure', (err: any, context: any) => {
            LogManager.error(`Circuit breaker failure: ${serviceName}`);
            // Only mark endpoint unhealthy if we have path context
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

    async routeRequest(service: ServiceConfig, req: any): Promise<any> {
        const cacheKey = `${service.name}:${req.method}:${req.path}`;
        
        // Check cache for GET requests
        if (req.method === 'GET') {
            const cachedResponse = await CacheManager.get(cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }
        }

        // Apply service-specific middleware
        for (const middleware of service.middleware) {
            await middleware(req);
        }

        // Route the request with timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Request timed out for ${service.name}`)), 
                service.timeout);
        });
        
        const requestPromise = this.executeRequest(service, req);
        const response = await Promise.race([requestPromise, timeoutPromise]);

        // Cache successful GET responses
        if (req.method === 'GET' && response) {
            await CacheManager.set(cacheKey, response, service.cacheTTL);
        }

        return response;
    }

    async executeRequest(service: ServiceConfig, req: any): Promise<any> {
        let lastError: Error;
        const startAttempt = Date.now();
        
        for (let attempt = 1; attempt <= service.maxRetries; attempt++) {
            try {
                const endpoint = await this.getHealthyEndpoint(service);
                if (!endpoint) {
                    throw new Error(`No healthy endpoints available for ${service.name}`);
                }
                
                // Track active connections for least-connections load balancing
                endpoint.activeConnections++;
                
                try {
                    const result = await endpoint.handler(req);
                    
                    // Mark endpoint as healthy on success
                    this._markServiceEndpoint(service.name, endpoint.path, true);
                    
                    // Decrease active connections counter
                    endpoint.activeConnections = Math.max(0, endpoint.activeConnections - 1);
                    
                    return result;
                } catch (error) {
                    // Decrease active connections counter even on error
                    endpoint.activeConnections = Math.max(0, endpoint.activeConnections - 1);
                    
                    // Mark endpoint as potentially unhealthy
                    this._markServiceEndpoint(service.name, endpoint.path, false);
                    throw error;
                }
            } catch (error: any) {
                lastError = error;
                LogManager.error(`Request failed for ${service.name}, attempt ${attempt}/${service.maxRetries}`, error);
                
                // Wait before retry using exponential backoff with jitter
                if (attempt < service.maxRetries) {
                    const backoff = Math.pow(2, attempt) * 100;
                    const jitter = Math.random() * 100;
                    await new Promise(resolve => setTimeout(resolve, backoff + jitter));
                }
            }
        }
        
        const totalTime = Date.now() - startAttempt;
        LogManager.warning(`All ${service.maxRetries} retry attempts failed for ${service.name} after ${totalTime}ms`);
        throw lastError!;
    }

    async getHealthyEndpoint(service: ServiceConfig): Promise<ServiceEndpoint | null> {
        // Filter healthy endpoints
        const endpoints = service.endpoints.filter(e => e.isHealthy);
        
        if (endpoints.length === 0) {
            // If no healthy endpoints, try all endpoints as a fallback
            LogManager.warning(`No healthy endpoints for ${service.name}, trying all endpoints`);
            if (service.endpoints.length === 0) return null;
            return service.endpoints[Math.floor(Math.random() * service.endpoints.length)];
        }
        
        // Apply load balancing strategy
        switch (service.loadBalancingStrategy) {
            case 'round-robin': {
                // Simple round-robin selection
                service._lastEndpointIndex = (service._lastEndpointIndex || 0) + 1;
                return endpoints[service._lastEndpointIndex % endpoints.length];
            }
            
            case 'least-connections': {
                // Select endpoint with fewest active connections
                return endpoints.reduce((min, endpoint) => 
                    (endpoint.activeConnections < min.activeConnections) ? endpoint : min, 
                    { activeConnections: Infinity } as ServiceEndpoint);
            }
            
            case 'weighted': {
                // Weighted random selection
                const weights = this.endpointWeights.get(service.name) || new Map();
                const totalWeight = endpoints.reduce((sum, endpoint) => 
                    sum + (weights.get(endpoint.path) || 1), 0);
                
                let random = Math.random() * totalWeight;
                for (const endpoint of endpoints) {
                    const weight = weights.get(endpoint.path) || 1;
                    random -= weight;
                    if (random <= 0) return endpoint;
                }
                return endpoints[0]; // Fallback
            }
            
            default: {
                // Default to random selection
                return endpoints[Math.floor(Math.random() * endpoints.length)];
            }
        }
    }

    createGatewayMiddleware() {
        return async (req: Request, res: Response, next: NextFunction) => {
            const serviceName = this.resolveService(req);
            if (!serviceName) {
                return next();
            }

            const breaker = this.circuitBreakers.get(serviceName);
            if (!breaker) {
                return next();
            }

            try {
                // Add tracking headers
                req.headers = req.headers || {};
                req.headers['x-gateway-request-id'] = crypto.randomBytes(8).toString('hex');
                req.headers['x-gateway-timestamp'] = Date.now().toString();
                
                const result = await breaker.fire(req);
                res.json(result);
            } catch (error: any) {
                LogManager.error('Gateway error', error);
                
                // Send appropriate error response
                if (error.message.includes('timeout')) {
                    res.status(504).json({ error: 'Gateway Timeout', message: error.message });
                } else if (error.message.includes('circuit breaker')) {
                    res.status(503).json({ error: 'Service Unavailable', message: 'Circuit breaker is open' });
                } else if (error.message.includes('No healthy endpoints')) {
                    res.status(503).json({ error: 'Service Unavailable', message: 'No healthy endpoints available' });
                } else {
                    res.status(502).json({ error: 'Bad Gateway', message: error.message });
                }
            }
        };
    }

    resolveService(req: Request): string | null {
        // Cache route resolution
        const cacheKey = `route:${req.path}`;
        if (this.routeCache.has(cacheKey)) {
            return this.routeCache.get(cacheKey)!;
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

    getServiceHealth(): Record<string, ServiceHealth> {
        const health: Record<string, ServiceHealth> = {};
        for (const [name, service] of this.services) {
            const breaker = this.circuitBreakers.get(name);
            
            // Calculate total health percentage
            const healthyEndpoints = service.endpoints.filter(e => e.isHealthy).length;
            const healthPercentage = service.endpoints.length > 0
                ? (healthyEndpoints / service.endpoints.length) * 100
                : 0;
                
            health[name] = {
                isActive: service.isActive,
                healthPercentage,
                circuitBreakerState: breaker ? {
                    state: breaker.status.state,
                    stats: {
                        successful: breaker.stats.successes,
                        failed: breaker.stats.failures,
                        rejected: breaker.stats.rejects,
                        timeout: breaker.stats.timeouts
                    }
                } : null,
                endpoints: service.endpoints.map(e => ({
                    path: e.path,
                    isHealthy: e.isHealthy,
                    failures: e.failures,
                    lastCheck: e.lastCheck,
                    activeConnections: e.activeConnections
                }))
            };
        }
        return health;
    }
    
    // Helper method to mark endpoint health status
    private _markServiceEndpoint(serviceName: string, path: string, isHealthy: boolean): void {
        const service = this.services.get(serviceName);
        if (!service) return;
        
        const endpoint = service.endpoints.find(e => path.startsWith(e.path));
        if (!endpoint) return;
        
        endpoint.lastCheck = Date.now();
        
        if (isHealthy) {
            endpoint.failures = 0;
            endpoint.isHealthy = true;
        } else {
            endpoint.failures++;
            // Mark as unhealthy after consecutive failures
            if (endpoint.failures >= 3) {
                endpoint.isHealthy = false;
            }
        }
    }
    
    // Start periodic health checks for all service endpoints
    private _startHealthChecks(): void {
        setInterval(async () => {
            for (const [serviceName, service] of this.services) {
                for (const endpoint of service.endpoints) {
                    try {
                        // Skip if endpoint was recently checked
                        if (Date.now() - endpoint.lastCheck < 10000) continue;
                        
                        // Basic health check
                        if (typeof service.healthCheck === 'function') {
                            // Use service-level health check if defined
                            const isHealthy = await service.healthCheck();
                            endpoint.isHealthy = isHealthy;
                            LogManager.debug(`Service-level health check for ${serviceName} endpoint ${endpoint.path}: ${isHealthy ? 'healthy' : 'unhealthy'}`);
                        } else if (typeof endpoint.healthCheck === 'function') {
                            // Use endpoint-specific health check if defined
                            const isHealthy = await endpoint.healthCheck();
                            endpoint.isHealthy = isHealthy;
                            LogManager.debug(`Endpoint-specific health check for ${serviceName} endpoint ${endpoint.path}: ${isHealthy ? 'healthy' : 'unhealthy'}`);
                        } else if (endpoint.handler && typeof endpoint.handler.get === 'function') {
                            // Try a simple probe - but only if handler is a router with a get method
                            LogManager.debug(`Using handler GET method for health check on ${serviceName} endpoint ${endpoint.path}`);
                            endpoint.isHealthy = true;
                        } else {
                            // Default to marking as healthy if no check method available
                            endpoint.isHealthy = true;
                            LogManager.debug(`No health check method available for ${serviceName} endpoint ${endpoint.path}, marking as healthy by default`);
                        }
                        endpoint.failures = 0;
                        endpoint.lastCheck = Date.now();
                    } catch (error) {
                        LogManager.debug(`Health check failed for ${serviceName} endpoint ${endpoint.path}`, error);
                        endpoint.failures++;
                        if (endpoint.failures >= 3) {
                            endpoint.isHealthy = false;
                        }
                    }
                }
                
                // Update circuit breaker if all endpoints are unhealthy
                const allUnhealthy = service.endpoints.length > 0 && 
                    service.endpoints.every(e => !e.isHealthy);
                    
                if (allUnhealthy && service.isActive) {
                    service.isActive = false;
                    LogManager.warning(`All endpoints for ${serviceName} are unhealthy, marking service as inactive`);
                } else if (!allUnhealthy && !service.isActive) {
                    service.isActive = true;
                    LogManager.info(`Service ${serviceName} recovered, marking as active`);
                }
            }
        }, 30000); // Check every 30 seconds
    }
    
    // Reset endpoint weights for weighted load balancing
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
    
    // Manually reset circuit breaker
    resetCircuitBreaker(serviceName: string): void {
        const breaker = this.circuitBreakers.get(serviceName);
        if (!breaker) {
            throw new Error(`Circuit breaker for ${serviceName} not found`);
        }
        
        breaker.close();
        LogManager.info(`Circuit breaker for ${serviceName} manually reset`);
    }
    
    // Get metrics for all services
    getMetrics(): Record<string, ServiceMetrics> {
        const metrics: Record<string, ServiceMetrics> = {};
        for (const [name, service] of this.services) {
            const breaker = this.circuitBreakers.get(name);
            if (!breaker) continue;
            
            metrics[name] = {
                success: breaker.stats.successes,
                failure: breaker.stats.failures,
                timeout: breaker.stats.timeouts,
                rejected: breaker.stats.rejects,
                fallback: breaker.stats.fallbacks,
                circuitState: breaker.status.state,
                healthyEndpoints: service.endpoints.filter(e => e.isHealthy).length,
                totalEndpoints: service.endpoints.length
            };
        }
        return metrics;
    }
}

export const gatewayManager = new GatewayManager();
export default gatewayManager;