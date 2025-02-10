const NodeCache = require('node-cache');
const LogManager = require('./LogManager');

class CacheManager {
    constructor() {
        // Standard TTL of 5 minutes, check for expired entries every minute
        this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
        
        // Track cache statistics
        this.stats = {
            hits: 0,
            misses: 0,
            keys: 0
        };
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
            keys: this.cache.keys().length
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

            // Store original res.json
            const originalJson = res.json;

            // Override res.json
            res.json = (data) => {
                this.set(cacheKey, data, ttl);
                return originalJson.call(res, data);
            };

            next();
        };
    }
}

module.exports = new CacheManager();