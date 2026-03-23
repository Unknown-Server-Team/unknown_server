const NodeCache = require('node-cache');
const LogManager = require('./LogManager');
const cluster = require('cluster');
const os = require('os');

class CacheManager {
    constructor() {
        this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

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
        this.workerId = this.isClusterWorker ? cluster.worker.id : 0;

        this.initializeClusterCommunication();

        this.startMemoryMonitoring();
    }

    initializeClusterCommunication() {
        if (this.isClusterWorker) {
            process.on('message', (message) => {
                if (message && message.type === 'cache:operation') {
                    if (message.workerId === this.workerId) return;

                    switch (message.operation) {
                        case 'set':
                            this.cache.set(message.key, message.value, message.ttl);
                            break;
                        case 'del':
                            this.cache.del(message.key);
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

    broadcastOperation(operation, data = {}) {
        if (this.isClusterWorker) {
            process.send({
                type: 'cache:operation',
                workerId: this.workerId,
                operation,
                ...data
            });
        }
    }

    startMemoryMonitoring() {
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

    detectMemoryLeak() {
        if (this.memoryUsageHistory.length < 5) return;

        const recentReadings = this.memoryUsageHistory.slice(-5);
        let consistentGrowth = true;

        for (let i = 1; i < recentReadings.length; i++) {
            if (recentReadings[i].heapUsed <= recentReadings[i-1].heapUsed) {
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

    async get(key) {
        const value = this.cache.get(key);
        if (value === undefined) {
            this.stats.misses++;
            return null;
        }
        this.stats.hits++;
        return value;
    }

    async set(key, value, ttl = 300) {
        try {
            this.cache.set(key, value, ttl);
            this.stats.keys = this.cache.keys().length;

            this.broadcastOperation('set', { key, value, ttl });
            return true;
        } catch (error) {
            LogManager.error('Cache set error', error);
            return false;
        }
    }

    async del(key) {
        try {
            this.cache.del(key);
            this.stats.keys = this.cache.keys().length;

            this.broadcastOperation('del', { key });
            return true;
        } catch (error) {
            LogManager.error('Cache delete error', error);
            return false;
        }
    }

    async flush() {
        try {
            this.cache.flushAll();
            this.stats.keys = 0;
            LogManager.info('Cache flushed successfully');

            this.broadcastOperation('flush');
            return true;
        } catch (error) {
            LogManager.error('Cache flush error', error);
            return false;
        }
    }

    getStats() {
        return {
            ...this.stats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            memoryUsage: this.cache.getStats().vsize,
            keys: this.cache.keys().length,
            worker: this.workerId
        };
    }

    getMemoryStats() {
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

    createCacheMiddleware(keyPrefix, ttl = 300) {
        return async (req, res, next) => {
            if (req.method !== 'GET') {
                return next();
            }

            const cacheKey = `${keyPrefix}:${req.originalUrl}`;
            const cachedData = await this.get(cacheKey);

            if (cachedData) {
                return res.json(cachedData);
            }

            const originalJson = res.json;

            res.json = (data) => {
                this.set(cacheKey, data, ttl);
                return originalJson.call(res, data);
            };

            next();
        };
    }
}

module.exports = new CacheManager();