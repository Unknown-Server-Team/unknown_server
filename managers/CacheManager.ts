import NodeCache from 'node-cache';
import cluster from 'cluster';
import Redis from 'ioredis';
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
type CacheBackend = 'memory' | 'redis';

class CacheManager {
    private cache: NodeCache;
    private redisClient: Redis | null;
    private redisKeyPrefix: string;
    private backend: CacheBackend;
    private backendReady: Promise<void>;
    private localKeys: Set<string>;
    private stats: CacheState;
    private memoryUsageHistory: MemoryUsageEntry[];
    private memoryLeakDetectionEnabled: boolean;
    private memoryLeakThreshold: number;
    private memoryCheckInterval: NodeJS.Timeout | null;
    private isClusterWorker: boolean;
    private workerId: number;

    constructor() {
        this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
        this.redisClient = null;
        this.redisKeyPrefix = 'unknown-server:cache:';
        this.backend = 'memory';
        this.backendReady = Promise.resolve();
        this.localKeys = new Set(this.cache.keys());
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
        this.backendReady = this.initializeBackend();
        this.startMemoryMonitoring();
    }

    private async initializeBackend(): Promise<void> {
        const redisUrl = process.env.REDIS_URL?.trim();
        const redisHost = process.env.REDIS_HOST?.trim();

        if (!redisUrl && !redisHost) {
            this.syncLocalKeysFromMemory();
            return;
        }

        const timeoutMs = 2000;
        const connectOptions = {
            lazyConnect: true,
            connectTimeout: timeoutMs,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1
        } as const;

        const client = redisUrl
            ? new Redis(redisUrl, connectOptions)
            : new Redis({
                host: redisHost,
                port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : 0,
                ...connectOptions
            });

        this.backend = 'redis';

        try {
            await Promise.race([
                client.connect(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Redis connection timed out')), timeoutMs);
                })
            ]);

            await client.ping();
            this.redisClient = client;
            this.backend = 'redis';
            await this.refreshRedisMirror();

            client.on('error', (error: unknown) => {
                this.handleRedisFailure(error);
            });

            client.on('end', () => {
                this.handleRedisFailure(new Error('Redis connection closed'));
            });

            LogManager.info('CacheManager using Redis backend');
        } catch (error: unknown) {
            client.disconnect();
            this.handleRedisFailure(error);
        }
    }

    private handleRedisFailure(error: unknown): void {
        if (this.backend !== 'redis') {
            return;
        }

        LogManager.warning('Redis cache unavailable, falling back to memory cache', error);

        if (this.redisClient) {
            this.redisClient.removeAllListeners();
            this.redisClient.disconnect();
            this.redisClient = null;
        }

        this.backend = 'memory';
        this.syncLocalKeysFromMemory();
    }

    private async refreshRedisMirror(): Promise<void> {
        if (!this.redisClient) {
            return;
        }

        this.cache.flushAll();
        this.localKeys.clear();

        const keys: string[] = [];
        let cursor = '0';
        do {
            const [nextCursor, scannedKeys] = await this.redisClient.scan(cursor, 'MATCH', `${this.redisKeyPrefix}*`, 'COUNT', '100');

            keys.push(...scannedKeys);

            cursor = nextCursor;
        } while (cursor !== '0');

        for (let i = 0; i < keys.length; i += 100) {
            const batch = keys.slice(i, i + 100);
            const values = await this.redisClient.mget(...batch);

            values.forEach((value, index) => {
                if (value !== null) {
                    const key = this.stripRedisPrefix(batch[index]);
                    this.cache.set(key, this.deserializeValue(value));
                    this.localKeys.add(key);
                }
            });
        }

        this.stats.keys = this.localKeys.size;
    }

    private syncLocalKeysFromMemory(): void {
        this.localKeys = new Set(this.cache.keys());
        this.stats.keys = this.localKeys.size;
    }

    private updateLocalKeySet(key: string, exists: boolean): void {
        if (exists) {
            this.localKeys.add(key);
        } else {
            this.localKeys.delete(key);
        }

        this.stats.keys = this.localKeys.size;
    }

    private clearLocalKeySet(): void {
        this.localKeys.clear();
        this.stats.keys = 0;
    }

    private getRedisKey(key: string): string {
        return `${this.redisKeyPrefix}${key}`;
    }

    private stripRedisPrefix(key: string): string {
        return key.startsWith(this.redisKeyPrefix) ? key.slice(this.redisKeyPrefix.length) : key;
    }

    private serializeValue(value: unknown): string {
        return JSON.stringify(value);
    }

    private deserializeValue(value: string): unknown {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    private cacheMemoryValue(key: string, value: unknown, ttl?: number): void {
        if (ttl !== undefined) {
            this.cache.set(key, value, ttl);
        } else {
            this.cache.set(key, value);
        }

        this.updateLocalKeySet(key, true);
    }

    private removeMemoryValue(key: string): void {
        this.cache.del(key);
        this.updateLocalKeySet(key, false);
    }

    private clearMemoryValues(): void {
        this.cache.flushAll();
        this.clearLocalKeySet();
    }

    private async ensureRedisKeyRemoval(pattern?: string): Promise<void> {
        if (!this.redisClient) {
            return;
        }

        const keysToDelete: string[] = [];
        const scanPattern = pattern ? `${this.redisKeyPrefix}${pattern}` : `${this.redisKeyPrefix}*`;

        let cursor = '0';
        do {
            const [nextCursor, keys] = await this.redisClient.scan(cursor, 'MATCH', scanPattern, 'COUNT', '100');

            for (const key of keys) {
                const strippedKey = this.stripRedisPrefix(key);
                if (pattern) {
                    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                    if (regex.test(strippedKey)) {
                        keysToDelete.push(key);
                    }
                } else {
                    keysToDelete.push(key);
                }
            }

            cursor = nextCursor;
        } while (cursor !== '0');

        for (let i = 0; i < keysToDelete.length; i += 500) {
            await this.redisClient.del(...keysToDelete.slice(i, i + 500));
        }

        if (!pattern) {
            this.clearLocalKeySet();
        } else {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            for (const key of [...this.localKeys]) {
                if (regex.test(key)) {
                    this.localKeys.delete(key);
                }
            }
            this.stats.keys = this.localKeys.size;
        }
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
                            if (message.key) {
                                this.cacheMemoryValue(message.key, message.value, message.ttl);
                            }
                            break;
                        case 'del':
                            if (message.key) {
                                this.removeMemoryValue(message.key);
                            }
                            break;
                        case 'flush':
                            this.clearMemoryValues();
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
        await this.backendReady;

        if (this.backend === 'redis' && this.redisClient) {
            try {
                const value = await this.redisClient.get(this.getRedisKey(key));

                if (value === null) {
                    this.stats.misses++;
                    return null;
                }

                this.stats.hits++;
                return this.deserializeValue(value);
            } catch (error: unknown) {
                this.handleRedisFailure(error);
            }
        }

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
            await this.backendReady;

            if (this.backend === 'redis' && this.redisClient) {
                await this.redisClient.set(this.getRedisKey(key), this.serializeValue(value), 'EX', ttl);
                this.cacheMemoryValue(key, value, ttl);
            } else {
                this.cacheMemoryValue(key, value, ttl);
            }

            this.broadcastOperation('set', { key, value, ttl });
            return true;
        } catch (error: unknown) {
            LogManager.error('Cache set error', error);
            return false;
        }
    }

    async del(key: string): Promise<boolean> {
        try {
            await this.backendReady;

            if (this.backend === 'redis' && this.redisClient) {
                await this.redisClient.del(this.getRedisKey(key));
            }

            this.removeMemoryValue(key);
            this.broadcastOperation('del', { key });
            return true;
        } catch (error: unknown) {
            LogManager.error('Cache delete error', error);
            return false;
        }
    }

    async flush(): Promise<boolean> {
        try {
            await this.backendReady;

            if (this.backend === 'redis' && this.redisClient) {
                await this.ensureRedisKeyRemoval();
            }

            this.clearMemoryValues();
            LogManager.info('Cache flushed successfully');
            this.broadcastOperation('flush');
            return true;
        } catch (error: unknown) {
            LogManager.error('Cache flush error', error);
            return false;
        }
    }

    keys(pattern?: string): string[] {
        const allKeys = [...this.localKeys];
        if (!pattern) {
            return allKeys;
        }
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return allKeys.filter((key: string) => regex.test(key));
    }

    getStats(): CacheStats {
        return {
            ...this.stats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            memoryUsage: this.cache.getStats().vsize,
            keys: this.localKeys.size,
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
