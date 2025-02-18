const LogManager = require('./LogManager');
const AuthMonitor = require('./AuthMonitor');
const WebsocketManager = require('./WebsocketManager');

class RatelimitManager {
    static whitelist = new Set();
    static blacklist = new Set();
    static customStores = new Map();
    static limiters = new Map();
    static burstProtection = new Map();
    static tokenBuckets = new Map();

    static create(options = {}) {
        const config = {
            windowMs: 15 * 60 * 1000,
            max: 100,
            message: 'Too many requests from this IP, please try again later.',
            burstMultiplier: 2,
            ...options
        };

        const limiterId = Math.random().toString(36).substr(2, 9);
        const store = new Map();
        const tokenBucket = new Map();

        this.limiters.set(limiterId, { store, config });
        this.tokenBuckets.set(limiterId, tokenBucket);

        return async (req, res, next) => {
            if (this.shouldSkipRateLimit(req)) {
                return next();
            }

            const key = this.generateKey(req, options.keyGenerator);
            const now = Date.now();

            // Check DDoS protection first
            if (this.isDDoSAttack(key, now)) {
                this.blacklistIP(key);
                return res.status(403).json({
                    error: 'Access denied due to suspicious activity'
                });
            }

            // Check burst protection
            if (this.isBurstAttack(key, now)) {
                return res.status(429).json({
                    error: 'Request burst detected, please slow down'
                });
            }

            // Token bucket algorithm
            const bucket = tokenBucket.get(key) || this.initTokenBucket(key, config);
            const tokens = this.getAvailableTokens(bucket, now, config);

            if (tokens < 1) {
                this.handleLimitReached(req, res);
                const retryAfter = Math.ceil((config.windowMs - (now - bucket.lastRefill)) / 1000);
                res.setHeader('Retry-After', retryAfter);
                return res.status(429).json({
                    error: config.message,
                    retryAfter
                });
            }

            // Sliding window counter
            const windowStart = now - config.windowMs;
            let requests = store.get(key) || { count: 0, timestamps: [] };
            requests.timestamps = requests.timestamps.filter(time => time > windowStart);

            if (requests.timestamps.length >= config.max) {
                this.handleLimitReached(req, res);
                const retryAfter = Math.ceil((requests.timestamps[0] - windowStart) / 1000);
                res.setHeader('Retry-After', retryAfter);
                return res.status(429).json({
                    error: config.message,
                    retryAfter
                });
            }

            // Update counters
            bucket.tokens--;
            tokenBucket.set(key, bucket);
            requests.timestamps.push(now);
            requests.count++;
            store.set(key, requests);

            // Update burst protection
            this.updateBurstProtection(key, now);

            next();
        };
    }

    static createLoginLimiter() {
        return this.create({
            windowMs: 15 * 60 * 1000,
            max: 5,
            message: 'Too many login attempts, please try again later',
            onLimitReached: (req) => {
                const ip = req.ip;
                AuthMonitor.trackLoginAttempt(false, ip);
                WebsocketManager.notifySecurityEvent('login_rate_limit', { ip });
                LogManager.warning('Login rate limit exceeded', { ip });
            }
        });
    }

    static createRegistrationLimiter() {
        return this.create({
            windowMs: 60 * 60 * 1000,
            max: 3,
            message: 'Too many accounts created from this IP',
            onLimitReached: (req) => {
                const ip = req.ip;
                WebsocketManager.notifySecurityEvent('registration_rate_limit', { ip });
                LogManager.warning('Registration rate limit exceeded', { ip });
            }
        });
    }

    static createPasswordResetLimiter() {
        return this.create({
            windowMs: 60 * 60 * 1000,
            max: 3,
            message: 'Too many password reset requests',
            onLimitReached: (req) => {
                const ip = req.ip;
                WebsocketManager.notifySecurityEvent('password_reset_rate_limit', { ip });
                LogManager.warning('Password reset rate limit exceeded', { ip });
            }
        });
    }

    static createApiLimiter(options = {}) {
        return this.create({
            windowMs: 60 * 1000, // 1 minute
            max: 60, // 60 requests per minute
            message: { error: 'Too many API requests' },
            ...options,
            onLimitReached: (req) => {
                const ip = req.ip;
                WebsocketManager.notifySecurityEvent('api_rate_limit', { ip });
                LogManager.warning('API rate limit exceeded', { ip });
                if (options.onLimitReached) {
                    options.onLimitReached(req);
                }
            }
        });
    }

    static createAuthLimiter(options = {}) {
        return RatelimitManager.create({
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 5, // 5 attempts per hour
            message: { error: 'Too many authentication attempts' },
            ...options,
            onLimitReached: (req) => {
                const ip = req.ip;
                WebsocketManager.notifySecurityEvent('auth_rate_limit', { ip });
                LogManager.warning('Authentication rate limit exceeded', { ip });
                if (options.onLimitReached) {
                    options.onLimitReached(req);
                }
            }
        });
    }

    static isDDoSAttack(ip, now) {
        const stats = this.burstProtection.get(ip) || { count: 0, firstRequest: now };
        return stats.count > 1000 && (now - stats.firstRequest) < 1000; // More than 1000 requests per second
    }

    static isBurstAttack(ip, now) {
        const stats = this.burstProtection.get(ip) || { count: 0, firstRequest: now };
        const timeDiff = now - stats.firstRequest;

        if (timeDiff > 1000) {
            stats.count = 1;
            stats.firstRequest = now;
        } else {
            stats.count++;
        }

        this.burstProtection.set(ip, stats);
        return stats.count > 100; // More than 100 requests per second
    }

    static initTokenBucket(key, config) {
        return {
            tokens: config.max,
            lastRefill: Date.now(),
            capacity: config.max
        };
    }

    static getAvailableTokens(bucket, now, config) {
        const timePassed = now - bucket.lastRefill;
        const refillRate = config.max / config.windowMs;
        const tokensToAdd = Math.floor(timePassed * refillRate);

        bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;

        return bucket.tokens;
    }

    static updateBurstProtection(ip, now) {
        const stats = this.burstProtection.get(ip) || { count: 0, firstRequest: now };
        stats.count++;
        this.burstProtection.set(ip, stats);
    }

    static shouldSkipRateLimit(req) {
        const ip = req.ip;
        return this.whitelist.has(ip);
    }

    static handleLimitReached(req, res) {
        const ip = req.ip;
        LogManager.warning('Rate limit exceeded', {
            ip,
            path: req.path,
            method: req.method
        });

        const offenderKey = `${ip}:offenses`;
        const offenses = this.customStores.get('offenders') || new Map();
        const currentOffenses = (offenses.get(offenderKey) || 0) + 1;
        offenses.set(offenderKey, currentOffenses);

        // More aggressive blacklisting for potential attacks
        if (currentOffenses >= 5 || this.isDDoSAttack(ip, Date.now())) {
            this.blacklistIP(ip);
            WebsocketManager.notifySecurityEvent('ip_blacklisted', { ip, offenses: currentOffenses });
            LogManager.warning('IP blacklisted due to repeated violations', { ip, offenses: currentOffenses });
        }

        this.customStores.set('offenders', offenses);
    }

    static generateKey(req, customKeyGenerator) {
        if (customKeyGenerator) {
            return customKeyGenerator(req);
        }
        // Get real IP from headers set by NGINX
        return req.headers['x-real-ip'] ||
            (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.ip);
    }

    static getRemainingRequests(ip, limiterId) {
        const limiter = this.limiters.get(limiterId);
        if (!limiter) return null;

        const { store, config } = limiter;
        const now = Date.now();
        const windowStart = now - config.windowMs;
        const requests = store.get(ip) || [];
        const validRequests = requests.filter(time => time > windowStart);

        return Math.max(0, config.max - validRequests.length);
    }

    static resetLimiter(limiterId) {
        const limiter = this.limiters.get(limiterId);
        if (limiter) {
            limiter.store.clear();
        }
    }

    static whitelistIP(ip) {
        this.whitelist.add(ip);
        this.blacklist.delete(ip);
        LogManager.info('IP whitelisted', { ip });
    }

    static blacklistIP(ip) {
        this.blacklist.add(ip);
        this.whitelist.delete(ip);
        LogManager.warning('IP blacklisted', { ip });
    }

    static removeIP(ip) {
        this.whitelist.delete(ip);
        this.blacklist.delete(ip);
        LogManager.info('IP removed from whitelist/blacklist', { ip });
    }

    static getIPStatus(ip) {
        if (this.whitelist.has(ip)) return 'whitelisted';
        if (this.blacklist.has(ip)) return 'blacklisted';
        return 'normal';
    }

    static resetOffenses(ip) {
        const offenders = this.customStores.get('offenders');
        if (offenders) {
            offenders.delete(`${ip}:offenses`);
            LogManager.info('Rate limit offenses reset', { ip });
        }
    }

    static setCustomStore(name, store) {
        this.customStores.set(name, store);
        LogManager.info('Custom rate limit store set', { name });
    }

    static createSlidingWindowLimiter(options) {
        const windowSize = options.windowMs || 60000;
        const maxRequests = options.max || 30;
        const requests = new Map();

        return (req, res, next) => {
            const now = Date.now();
            const ip = req.ip;

            if (!requests.has(ip)) {
                requests.set(ip, []);
            }

            const userRequests = requests.get(ip);
            const validRequests = userRequests.filter(time => now - time < windowSize);
            requests.set(ip, validRequests);

            if (validRequests.length >= maxRequests) {
                return res.status(429).json({
                    error: 'Too many requests',
                    retryAfter: Math.ceil((windowSize - (now - validRequests[0])) / 1000)
                });
            }

            validRequests.push(now);
            next();
        };
    }

    static cleanup() {
        const now = Date.now();

        // Cleanup limiters
        for (const [limiterId, limiter] of this.limiters) {
            const { store, config } = limiter;
            const windowStart = now - config.windowMs;

            for (const [key, data] of store) {
                const validTimestamps = data.timestamps.filter(time => time > windowStart);
                if (validTimestamps.length === 0) {
                    store.delete(key);
                } else {
                    store.set(key, { count: validTimestamps.length, timestamps: validTimestamps });
                }
            }
        }

        // Cleanup burst protection
        for (const [ip, stats] of this.burstProtection) {
            if (now - stats.firstRequest > 60000) { // Clear after 1 minute of inactivity
                this.burstProtection.delete(ip);
            }
        }

        // Cleanup token buckets older than 1 hour
        for (const [limiterId, buckets] of this.tokenBuckets) {
            for (const [key, bucket] of buckets) {
                if (now - bucket.lastRefill > 3600000) {
                    buckets.delete(key);
                }
            }
        }
    }
}

// Create singleton instance
const ratelimitManager = new RatelimitManager();

// Export both the class and instance
module.exports = ratelimitManager;
module.exports.RatelimitManager = RatelimitManager;

// More frequent cleanup
setInterval(() => RatelimitManager.cleanup(), 5 * 60 * 1000); // Every 5 minutes