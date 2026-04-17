export interface MeshServiceConfig {
    name: string;
    url: string;
    healthCheck?: (service: ServiceInfo) => Promise<boolean>;
    version: string;
    tags?: string[];
    discoverable?: boolean;
}

export interface ServiceInfo {
    name: string;
    url: string;
    version: string;
    status: 'registered' | 'healthy' | 'unhealthy' | 'error';
    lastSeen: number;
    failureCount: number;
    tags: string[];
    discoverable: boolean;
    metrics: MeshServiceMetrics;
    healthCheck: (service: ServiceInfo) => Promise<boolean>;
}

export interface MeshServiceMetrics {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    availabilityPercentage: number;
}

export interface ServiceDiscoveryRecord {
    name: string;
    url: string;
    version: string;
    status: string;
    tags: string[];
    lastUpdate: number;
}

export interface RouteConfig {
    target: string;
    routes: string[];
    middleware?: Array<(req: unknown) => Promise<void>>;
    loadBalancingStrategy?: string;
    timeout?: number;
    retryAttempts?: number;
    circuitBreaker?: boolean;
}

export interface ServiceProxy {
    target: string;
    routes: string[];
    middleware: Array<(req: unknown) => Promise<void>>;
    loadBalancer: (endpoints: unknown[]) => unknown;
    timeout: number;
    retryAttempts: number;
    circuitBreaker: boolean;
}

export interface MeshConfig {
    healthCheckInterval: number;
    metricCollectionInterval: number;
    retryAttempts: number;
    loadBalancingStrategy: string;
    maxConcurrentRequests: number;
    autoRecoveryEnabled: boolean;
    autoRecoveryInterval: number;
    failureThreshold: number;
}

export interface ServiceFilters {
    tag?: string;
    status?: string;
}

export interface LoadBalancingEndpoint {
    weight?: number;
    activeConnections: number;
}
