const LogManager = require('./LogManager');

class VersionManager {
    constructor() {
        this.versions = new Map();
        this.deprecatedVersions = new Set();
    }

    registerVersion(version, router) {
        if (this.versions.has(version)) {
            throw new Error(`Version ${version} already registered`);
        }
        this.versions.set(version, router);
        LogManager.info(`API version ${version} registered`);
    }

    getVersionRouter(version) {
        return this.versions.get(version);
    }

    deprecateVersion(version, deprecationDate) {
        if (!this.versions.has(version)) {
            throw new Error(`Version ${version} not found`);
        }
        this.deprecatedVersions.add(version);
        LogManager.warning(`API version ${version} marked as deprecated, will be removed after ${deprecationDate}`);
    }

    isDeprecated(version) {
        return this.deprecatedVersions.has(version);
    }

    getSupportedVersions() {
        return Array.from(this.versions.keys());
    }

    createVersionMiddleware() {
        return (req, res, next) => {
            const version = req.headers['accept-version'] || 'v1';
            
            if (!this.versions.has(version)) {
                return res.status(400).json({
                    error: 'Unsupported API version',
                    supportedVersions: this.getSupportedVersions()
                });
            }

            if (this.isDeprecated(version)) {
                res.set('Warning', `299 - "This API version is deprecated"`);
            }

            req.apiVersion = version;
            next();
        };
    }
}

module.exports = new VersionManager();