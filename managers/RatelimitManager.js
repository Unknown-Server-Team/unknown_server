const rateLimit = require('express-rate-limit');
const LogManager = require('./LogManager');

class RatelimitManager {
    static whitelist = new Set();
    static blacklist = new Set();
    static customStores = new Map();

    static create(options = {}) {
        const defaultOptions = {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limit each IP to 100 requests per windowMs
            message: 'Too many requests from this IP, please try again later.',
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => this.shouldSkipRateLimit(req),
            onLimitReached: (req, res) => {
                LogManager.warn(`Rate limit exceeded for IP: ${req.ip}`);
                this.handleLimitReached(req, res);
            }
        };

        return rateLimit({
            ...defaultOptions,
            ...options,
            keyGenerator: (req) => this.generateKey(req, options.keyGenerator)
        });
    }

    static shouldSkipRateLimit(req) {
        const ip = req.ip;
        if (this.whitelist.has(ip)) {
            LogManager.debug('Skipping rate limit for whitelisted IP', { ip });
            return true;
        }
        if (this.blacklist.has(ip)) {
            LogManager.warning('Blocked request from blacklisted IP', { ip });
            return false;
        }
        return false;
    }

    static handleLimitReached(req, res) {
        const ip = req.ip;
        LogManager.warning('Rate limit exceeded', { 
            ip,
            path: req.path,
            method: req.method
        });
        
        // Track repeated offenders
        const offenderKey = `${ip}:offenses`;
        const offenses = this.customStores.get('offenders') || new Map();
        const currentOffenses = (offenses.get(offenderKey) || 0) + 1;
        offenses.set(offenderKey, currentOffenses);
        
        if (currentOffenses >= 5) {
            this.blacklist.add(ip);
            LogManager.warning('IP blacklisted due to repeated violations', {
                ip,
                offenses: currentOffenses
            });
        }

        this.customStores.set('offenders', offenses);
    }

    static generateKey(req, customKeyGenerator) {
        if (customKeyGenerator) {
            return customKeyGenerator(req);
        }
        return req.ip;
    }

    static createApiLimiter(options = {}) {
        return this.create({
            windowMs: 60 * 1000, // 1 minute
            max: 60, // 60 requests per minute
            message: { error: 'Too many API requests' },
            ...options
        });
    }

    static createAuthLimiter(options = {}) {
        return this.create({
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 5, // 5 attempts per hour
            message: { error: 'Too many authentication attempts' },
            ...options
        });
    }

    static whitelistIP(ip) {
        this.whitelist.add(ip);
        this.blacklist.delete(ip); // Remove from blacklist if present
        LogManager.info('IP whitelisted', { ip });
    }

    static blacklistIP(ip) {
        this.blacklist.add(ip);
        this.whitelist.delete(ip); // Remove from whitelist if present
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
}

module.exports = RatelimitManager;