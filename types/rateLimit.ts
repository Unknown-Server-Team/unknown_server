import type { Request } from 'express';

export interface RateLimitConfig {
    windowMs: number;
    max: number;
    message: string | object;
    burstMultiplier?: number;
    keyGenerator?: (req: Request) => string;
    onLimitReached?: (req: Request) => void;
}

export interface RequestData {
    count: number;
    timestamps: number[];
}

export interface LimiterStore {
    store: Map<string, RequestData>;
    config: RateLimitConfig;
}

export interface BurstStats {
    count: number;
    firstRequest: number;
}

export interface TokenBucket {
    tokens: number;
    lastRefill: number;
    capacity: number;
}

export type IPStatus = 'whitelisted' | 'blacklisted' | 'normal';
