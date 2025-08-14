const LogManager = require('./LogManager');
import { Request, Response, NextFunction, Router } from 'express';

// Extend Request interface to include apiVersion
declare global {
    namespace Express {
        interface Request {
            apiVersion?: string;
        }
    }
}

class VersionManager {
    private versions: Map<string, Router>;
    private deprecatedVersions: Set<string>;

    constructor() {
        this.versions = new Map();
        this.deprecatedVersions = new Set();
    }

    registerVersion(version: string, router: Router): void {
        if (this.versions.has(version)) {
            throw new Error(`Version ${version} already registered`);
        }
        this.versions.set(version, router);
        LogManager.info(`API version ${version} registered`);
    }

    getVersionRouter(version: string): Router | undefined {
        return this.versions.get(version);
    }

    deprecateVersion(version: string, deprecationDate: string): void {
        if (!this.versions.has(version)) {
            throw new Error(`Version ${version} not found`);
        }
        this.deprecatedVersions.add(version);
        LogManager.warning(`API version ${version} marked as deprecated, will be removed after ${deprecationDate}`);
    }

    isDeprecated(version: string): boolean {
        return this.deprecatedVersions.has(version);
    }

    getSupportedVersions(): string[] {
        return Array.from(this.versions.keys());
    }

    createVersionMiddleware() {
        return (req: Request, res: Response, next: NextFunction): void => {
            const version = req.headers['accept-version'] as string || 'v1';
            
            if (!this.versions.has(version)) {
                res.status(400).json({
                    error: 'Unsupported API version',
                    supportedVersions: this.getSupportedVersions()
                });
                return;
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