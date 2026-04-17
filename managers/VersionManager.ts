import type { NextFunction, Response, Router } from 'express';
import type { VersionedRequest, UnsupportedVersionResponse } from '../types/version';
import LogManager from './LogManager';

class VersionManager {
    private versions: Map<string, Router>;
    private deprecatedVersions: Set<string>;

    constructor() {
        this.versions = new Map<string, Router>();
        this.deprecatedVersions = new Set<string>();
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

    createVersionMiddleware(): (req: VersionedRequest, res: Response<UnsupportedVersionResponse>, next: NextFunction) => Response<UnsupportedVersionResponse> | void {
        return (req: VersionedRequest, res: Response<UnsupportedVersionResponse>, next: NextFunction): Response<UnsupportedVersionResponse> | void => {
            const headerVersion = req.headers['accept-version'];
            const version = typeof headerVersion === 'string' ? headerVersion : 'v1';

            if (!this.versions.has(version)) {
                return res.status(400).json({
                    error: 'Unsupported API version',
                    supportedVersions: this.getSupportedVersions()
                });
            }

            if (this.isDeprecated(version)) {
                res.set('Warning', '299 - "This API version is deprecated"');
            }

            req.apiVersion = version;
            next();
        };
    }
}

const versionManager = new VersionManager();

export = versionManager;