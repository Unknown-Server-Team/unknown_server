import type { Request } from 'express';
import type CircuitBreaker from 'opossum';

export type LoadBalancingStrategy = 'round-robin' | 'least-connections' | 'weighted';
export type GatewayResponse = unknown;

export type GatewayRequest = Request;

export interface GatewayHandler {
    (req: GatewayRequest): Promise<GatewayResponse>;
    get?: unknown;
}

export interface ServiceEndpoint {
    path: string;
    handler: GatewayHandler;
    weight?: number;
    isHealthy?: boolean;
    failures?: number;
    lastCheck?: number;
    activeConnections?: number;
    healthCheck?: () => Promise<boolean>;
}

export interface ServiceRegistrationOptions {
    healthCheck?: () => Promise<boolean>;
    timeout?: number;
    maxRetries?: number;
    endpoints?: ServiceEndpoint[];
    cacheTTL?: number;
    middleware?: Array<(req: GatewayRequest) => Promise<void>>;
    loadBalancingStrategy?: LoadBalancingStrategy;
    tags?: string[];
    version?: string;
    circuitBreaker?: CircuitBreakerOptions;
    registerWithMesh?: boolean;
    meshUrl?: string;
    [key: string]: unknown;
}

export interface ServiceEndpointState extends Omit<ServiceEndpoint, 'isHealthy' | 'failures' | 'lastCheck' | 'activeConnections'> {
    isHealthy: boolean;
    failures: number;
    lastCheck: number;
    activeConnections: number;
}

export interface ServiceConfig extends ServiceRegistrationOptions {
    name: string;
    healthCheck: () => Promise<boolean>;
    timeout: number;
    maxRetries: number;
    endpoints: ServiceEndpointState[];
    isActive: boolean;
    cacheTTL: number;
    middleware: Array<(req: GatewayRequest) => Promise<void>>;
    loadBalancingStrategy: LoadBalancingStrategy;
    tags: string[];
    version: string;
    _lastEndpointIndex?: number;
}

export interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    volumeThreshold?: number;
}

export type CircuitState = 'open' | 'half-open' | 'closed';

export type GatewayCircuitBreakerState = CircuitBreaker<[GatewayRequest], GatewayResponse>;

export interface ServiceHealthEndpoint {
    path: string;
    isHealthy: boolean;
    failures: number;
    lastCheck: number;
    activeConnections: number;
}

export interface ServiceHealth {
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
    endpoints: ServiceHealthEndpoint[];
}

export interface GatewayServiceMetrics {
    success: number;
    failure: number;
    timeout: number;
    rejected: number;
    fallback: number;
    circuitState: string;
    healthyEndpoints: number;
    totalEndpoints: number;
}

export interface ServiceMeshRegistration {
    name: string;
    url: string;
    version: string;
    tags: string[];
    discoverable: boolean;
}

export interface ServiceMeshManagerModule {
    registerService(service: ServiceMeshRegistration): void;
}

export interface PerformanceManagerModule {
    trackRequest(duration: number, statusCode: number, path: string): void;
    trackError(error: unknown, path: string): void;
}
