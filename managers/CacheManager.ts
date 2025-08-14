import NodeCache from 'node-cache';
import cluster from 'cluster';
import os from 'os';
import { Request, Response, NextFunction } from 'express';

const LogManager = require('./LogManager');

// Interfaces for cache management
interface CacheStats {
    hits: number;
    misses: number;
    keys: number;
    hitRate: number;
    memoryUsage: number;
    worker: number;
}

interface MemoryUsageEntry {
    timestamp: number;
    heapUsed: number;
}

interface MemoryStats {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    history: MemoryUsageEntry[];
    cacheSize: number;
}

interface CacheMessage {
    type: 'cache:operation';
    workerId: number;
    operation: 'set' | 'del' | 'flush';
    key?: string;
    value?: any;
    ttl?: number;
}

class CacheManager {
    private cache: NodeCache;
    private stats: {
        hits: number;
        misses: number;
        keys: number;
    };
    private memoryUsageHistory: MemoryUsageEntry[];
    private memoryLeakDetectionEnabled: boolean;
    private memoryLeakThreshold: number;
    private memoryCheckInterval: NodeJS.Timeout | null;
    private isClusterWorker: boolean;
    private workerId: number;

    constructor() {
        // Standard TTL of 5 minutes, check for expired entries every minute
        this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
        
        // Track cache statistics
        this.stats = {
            hits: 0,
            misses: 0,
            keys: 0
        };

        // Memory usage tracking
        this.memoryUsageHistory = [];
        this.memoryLeakDetectionEnabled = true;
        this.memoryLeakThreshold = 0.10; // 10% growth in 5 consecutive checks indicates potential leak
        this.memoryCheckInterval = null;
        
        // Setup cluster-aware capabilities if worker
        this.isClusterWorker = cluster.isWorker;
        this.workerId = this.isClusterWorker && cluster.worker ? cluster.worker.id : 0;
        
        // Initialize cluster communication for cache sync
        this.initializeClusterCommunication();
        
        // Start memory leak detection
        this.startMemoryMonitoring();
    }

    private initializeClusterCommunication(): void {
        if (this.isClusterWorker) {
            // Listen for cache operations from other workers
            process.on('message', (message: any) => {
                if (message && message.type === 'cache:operation') {
                    // Skip processing messages originating from this worker
                    if (message.workerId === this.workerId) return;
                    
                    const cacheMessage = message as CacheMessage;
                    switch (cacheMessage.operation) {
                        case 'set':
                            if (cacheMessage.key && cacheMessage.value !== undefined) {
                                this.cache.set(cacheMessage.key, cacheMessage.value, cacheMessage.ttl);
                            }
                            break;
                        case 'del':
                            if (cacheMessage.key) {
                                this.cache.del(cacheMessage.key);
                            }
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

    private broadcastOperation(operation: 'set' | 'del' | 'flush', data: Partial<CacheMessage> = {}): void {
        if (this.isClusterWorker && process.send) {
            process.send({
                type: 'cache:operation',
                workerId: this.workerId,
                operation,
                ...data
            } as CacheMessage);
        }
    }

    private startMemoryMonitoring(): void {
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }

        this.memoryCheckInterval = setInterval(() => {
            // Get current memory usage
            const memoryUsage = process.memoryUsage();
            const heapUsed = memoryUsage.heapUsed / 1024 / 1024; // MB
            const timestamp = Date.now();
            
            // Store history (keep last 10 readings)
            this.memoryUsageHistory.push({ timestamp, heapUsed });
            if (this.memoryUsageHistory.length > 10) {
                this.memoryUsageHistory.shift();
            }
            
            // Check for memory leaks if we have enough data points
            if (this.memoryUsageHistory.length >= 5 && this.memoryLeakDetectionEnabled) {
                this.detectMemoryLeak();
            }
            
            // Log memory stats periodically (every 5 checks)
            if (this.memoryUsageHistory.length % 5 === 0) {
                const cacheStats = this.getStats();
                LogManager.debug(`Memory usage: ${heapUsed.toFixed(2)} MB, Cache entries: ${cacheStats.keys}, Cache memory: ${(cacheStats.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
            }
        }, 60000); // Check every minute
    }

    private detectMemoryLeak(): void {
        if (this.memoryUsageHistory.length < 5) return;

        // Check the last 5 readings
        const recentReadings = this.memoryUsageHistory.slice(-5);
        let consistentGrowth = true;
        
        // Check if memory usage has consistently increased
        for (let i = 1; i < recentReadings.length; i++) {
            if (recentReadings[i].heapUsed <= recentReadings[i-1].heapUsed) {
                consistentGrowth = false;
                break;
            }
        }
        
        // Calculate growth percentage
        if (consistentGrowth) {
            const firstReading = recentReadings[0].heapUsed;
            const lastReading = recentReadings[recentReadings.length - 1].heapUsed;
            const growthPercentage = (lastReading - firstReading) / firstReading;
            
            if (growthPercentage >= this.memoryLeakThreshold) {
                LogManager.warning(`Potential memory leak detected! Memory grew by ${(growthPercentage * 100).toFixed(2)}% over the last 5 checks.`);
                
                // Check if cache growth correlates with memory growth
                const cacheSize = this.cache.getStats().vsize / 1024 / 1024; // MB
                LogManager.warning(`Current cache size: ${cacheSize.toFixed(2)} MB`);
                
                // Get heap snapshot if in development
                if (process.env.NODE_ENV === 'development') {
                    LogManager.info('In development mode - consider using --inspect flag with Chrome DevTools to capture heap snapshots');
                }
            }
        }
    }

    async get(key: string): Promise<any> {
        const value = this.cache.get(key);
        if (value === undefined) {
            this.stats.misses++;
            return null;
        }
        this.stats.hits++;
        return value;
    }

    async set(key: string, value: any, ttl: number = 300): Promise<boolean> {
        try {
            this.cache.set(key, value, ttl);
            this.stats.keys = this.cache.keys().length;
            
            // Broadcast to other workers
            this.broadcastOperation('set', { key, value, ttl });
            return true;
        } catch (error) {
            LogManager.error('Cache set error', error);
            return false;
        }
    }

    async del(key: string): Promise<boolean> {
        try {
            this.cache.del(key);
            this.stats.keys = this.cache.keys().length;
            
            // Broadcast to other workers
            this.broadcastOperation('del', { key });
            return true;
        } catch (error) {
            LogManager.error('Cache delete error', error);
            return false;
        }
    }

    async flush(): Promise<boolean> {
        try {
            this.cache.flushAll();
            this.stats.keys = 0;
            LogManager.info('Cache flushed successfully');
            
            // Broadcast to other workers
            this.broadcastOperation('flush');
            return true;
        } catch (error) {
            LogManager.error('Cache flush error', error);
            return false;
        }
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
            rss: memUsage.rss / 1024 / 1024, // MB
            heapTotal: memUsage.heapTotal / 1024 / 1024, // MB
            heapUsed: memUsage.heapUsed / 1024 / 1024, // MB
            external: memUsage.external / 1024 / 1024, // MB
            history: this.memoryUsageHistory,
            cacheSize: this.cache.getStats().vsize / 1024 / 1024 // MB
        };
    }

    createCacheMiddleware(keyPrefix: string, ttl: number = 300) {
        return async (req: Request, res: Response, next: NextFunction) => {
            if (req.method !== 'GET') {
                return next();
            }

            const cacheKey = `${keyPrefix}:${req.originalUrl}`;
            const cachedData = await this.get(cacheKey);

            if (cachedData) {
                return res.json(cachedData);
            }

            // Store original res.json
            const originalJson = res.json.bind(res);

            // Override res.json
            res.json = (data: any) => {
                this.set(cacheKey, data, ttl);
                return originalJson(data);
            };

            next();
        };
    }
}

export = new CacheManager();