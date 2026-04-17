import NodeCache from 'node-cache';
import cluster from 'cluster';
import { NextFunction, Request, Response } from 'express';
import type {
    CacheState,
    CacheStats,
    MemoryUsageEntry,
    MemoryStats,
    CacheMessage
} from '../types/cache';

const LogManager = require('./LogManager');

function isCacheMessage(message: unknown): message is CacheMessage {
    if (typeof message !== 'object' || message === null) {
        return false;
    }

    const candidate = message as Partial<CacheMessage>;
    return candidate.type === 'cache:operation' && typeof candidate.workerId === 'number';
}

type CacheResponseBody = unknown;
type CacheMiddlewareResponse = Response<CacheResponseBody>;
type JsonHandler = (body?: CacheResponseBody) => CacheMiddlewareResponse;

class CacheManager {
    private cache: NodeCache<unknown>;
    private stats: CacheState;
    private memoryUsageHistory: MemoryUsageEntry[];
    private memoryLeakDetectionEnabled: boolean;
    private memoryLeakThreshold: number;
    private memoryCheckInterval: NodeJS.Timeout | null;
    private isClusterWorker: boolean;
    private workerId: number;

    constructor() {
        this.cache = new NodeCache<unknown>({ stdTTL: 300, checkperiod: 60 });
        this.stats = {
            hits: 0,
            misses: 0,
            keys: 0
        };
        this.memoryUsageHistory = [];
        this.memoryLeakDetectionEnabled = true;
        this.memoryLeakThreshold = 0.10;
        this.memoryCheckInterval = null;
        this.isClusterWorker = cluster.isWorker;
        this.workerId = this.isClusterWorker && cluster.worker ? cluster.worker.id : 0;
        this.initializeClusterCommunication();
        this.startMemoryMonitoring();
    }

    private initializeClusterCommunication(): void {
        if (this.isClusterWorker) {
            process.on('message', (message: unknown) => {
                if (isCacheMessage(message)) {
                    if (message.workerId === this.workerId) {
                        return;
                    }

                    switch (message.operation) {
                        case 'set':
                            this.cache.set(message.key as string, message.value, message.ttl);
                            break;
                        case 'del':
                            this.cache.del(message.key as string);
                            break;
                        case 'flush':
                            this.cache.flushAll();
                            this.stats.keys = 0;
                            break;
                    }
                }
            });
        }
    }

    private broadcastOperation(operation: CacheMessage['operation'], data: Omit<Partial<CacheMessage>, 'type' | 'workerId' | 'operation'> = {}): void {
        if (this.isClusterWorker && process.send) {
            process.send({
                type: 'cache:operation',
                workerId: this.workerId,
                operation,
                ...data
            });
        }
    }

    private startMemoryMonitoring(): void {
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }

        this.memoryCheckInterval = setInterval(() => {
            const memoryUsage = process.memoryUsage();
            const heapUsed = memoryUsage.heapUsed / 1024 / 1024;
            const timestamp = Date.now();

            this.memoryUsageHistory.push({ timestamp, heapUsed });
            if (this.memoryUsageHistory.length > 10) {
                this.memoryUsageHistory.shift();
            }

            if (this.memoryUsageHistory.length >= 5 && this.memoryLeakDetectionEnabled) {
                this.detectMemoryLeak();
            }

            if (this.memoryUsageHistory.length % 5 === 0) {
                const cacheStats = this.getStats();
                LogManager.debug(`Memory usage: ${heapUsed.toFixed(2)} MB, Cache entries: ${cacheStats.keys}, Cache memory: ${(cacheStats.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
            }
        }, 60000);
    }

    private detectMemoryLeak(): void {
        if (this.memoryUsageHistory.length < 5) {
            return;
        }

        const recentReadings = this.memoryUsageHistory.slice(-5);
        let consistentGrowth = true;

        for (let i = 1; i < recentReadings.length; i++) {
            if (recentReadings[i].heapUsed <= recentReadings[i - 1].heapUsed) {
                consistentGrowth = false;
                break;
            }
        }

        if (consistentGrowth) {
            const firstReading = recentReadings[0].heapUsed;
            const lastReading = recentReadings[recentReadings.length - 1].heapUsed;
            const growthPercentage = (lastReading - firstReading) / firstReading;

            if (growthPercentage >= this.memoryLeakThreshold) {
                LogManager.warning(`Potential memory leak detected! Memory grew by ${(growthPercentage * 100).toFixed(2)}% over the last 5 checks.`);
                const cacheSize = this.cache.getStats().vsize / 1024 / 1024;
                LogManager.warning(`Current cache size: ${cacheSize.toFixed(2)} MB`);

                if (process.env.NODE_ENV === 'development') {
                    LogManager.info('In development mode - consider using --inspect flag with Chrome DevTools to capture heap snapshots');
                }
            }
        }
    }

    async get(key: string): Promise<unknown | null> {
        const value = this.cache.get(key);
        if (value === undefined) {
            this.stats.misses++;
            return null;
        }
        this.stats.hits++;
        return value;
    }

    async set(key: string, value: unknown, ttl: number = 300): Promise<boolean> {
        try {
            this.cache.set(key, value, ttl);
            this.stats.keys = this.cache.keys().length;
            this.broadcastOperation('set', { key, value, ttl });
            return true;
        } catch (error: unknown) {
            LogManager.error('Cache set error', error);
            return false;
        }
    }

    async del(key: string): Promise<boolean> {
        try {
            this.cache.del(key);
            this.stats.keys = this.cache.keys().length;
            this.broadcastOperation('del', { key });
            return true;
        } catch (error: unknown) {
            LogManager.error('Cache delete error', error);
            return false;
        }
    }

    async flush(): Promise<boolean> {
        try {
            this.cache.flushAll();
            this.stats.keys = 0;
            LogManager.info('Cache flushed successfully');
            this.broadcastOperation('flush');
            return true;
        } catch (error: unknown) {
            LogManager.error('Cache flush error', error);
            return false;
        }
    }

    keys(pattern?: string): string[] {
        const allKeys = this.cache.keys();
        if (!pattern) {
            return allKeys;
        }
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return allKeys.filter((key) => regex.test(key));
    }

    getStats(): CacheStats {
        return {
            ...this.stats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            memoryUsage: this.cache.getStats().vsize,
            keys: this.cache.keys().length,
            worker: this.workerId
        };
    }

    getMemoryStats(): MemoryStats {
        const memUsage = process.memoryUsage();
        return {
            rss: memUsage.rss / 1024 / 1024,
            heapTotal: memUsage.heapTotal / 1024 / 1024,
            heapUsed: memUsage.heapUsed / 1024 / 1024,
            external: memUsage.external / 1024 / 1024,
            history: this.memoryUsageHistory,
            cacheSize: this.cache.getStats().vsize / 1024 / 1024
        };
    }

    createCacheMiddleware(keyPrefix: string, ttl: number = 300): (req: Request, res: CacheMiddlewareResponse, next: NextFunction) => Promise<CacheMiddlewareResponse | void> {
        return async (req: Request, res: CacheMiddlewareResponse, next: NextFunction): Promise<CacheMiddlewareResponse | void> => {
            if (req.method !== 'GET') {
                return next();
            }

            const cacheKey = `${keyPrefix}:${req.originalUrl}`;
            const cachedData = await this.get(cacheKey);

            if (cachedData) {
                return res.json(cachedData);
            }

            const originalJson = res.json as JsonHandler;

            res.json = ((data?: CacheResponseBody) => {
                this.set(cacheKey, data, ttl);
                return originalJson.call(res, data);
            }) as typeof res.json;

            next();
        };
    }
}

module.exports = new CacheManager();
