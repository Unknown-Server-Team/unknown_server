export interface CacheState {
    hits: number;
    misses: number;
    keys: number;
}

export interface CacheStats extends CacheState {
    hitRate: number;
    memoryUsage: number;
    worker: number;
}

export interface MemoryUsageEntry {
    timestamp: number;
    heapUsed: number;
}

export interface MemoryStats {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    history: MemoryUsageEntry[];
    cacheSize: number;
}

export interface CacheMessage {
    type: 'cache:operation';
    workerId: number;
    operation: 'set' | 'del' | 'flush';
    key?: string;
    value?: unknown;
    ttl?: number;
}
