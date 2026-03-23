import express, { Router } from 'express';

const mockLogManager = {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};

jest.mock('../managers/LogManager', () => mockLogManager);

let VersionManager: any;

beforeEach(() => {
    jest.resetModules();
    VersionManager = require('../managers/VersionManager');
});

describe('VersionManager', () => {
    it('starts with no registered versions', () => {
        expect(VersionManager.getSupportedVersions()).toEqual([]);
    });

    it('registers a version successfully', () => {
        const router: Router = express.Router();
        VersionManager.registerVersion('v1', router);
        expect(VersionManager.getSupportedVersions()).toContain('v1');
    });

    it('throws when registering duplicate version', () => {
        const router: Router = express.Router();
        VersionManager.registerVersion('v2', router);
        expect(() => VersionManager.registerVersion('v2', router)).toThrow();
    });

    it('getVersionRouter returns the registered router', () => {
        const router: Router = express.Router();
        VersionManager.registerVersion('v3', router);
        expect(VersionManager.getVersionRouter('v3')).toBe(router);
    });

    it('getVersionRouter returns undefined for unregistered version', () => {
        expect(VersionManager.getVersionRouter('v99')).toBeUndefined();
    });

    it('isDeprecated returns false for non-deprecated version', () => {
        const router: Router = express.Router();
        VersionManager.registerVersion('v4', router);
        expect(VersionManager.isDeprecated('v4')).toBe(false);
    });

    it('deprecateVersion marks version as deprecated', () => {
        const router: Router = express.Router();
        VersionManager.registerVersion('v5', router);
        VersionManager.deprecateVersion('v5', '2025-01-01');
        expect(VersionManager.isDeprecated('v5')).toBe(true);
    });

    it('throws when deprecating non-existent version', () => {
        expect(() => VersionManager.deprecateVersion('v999', '2025-01-01')).toThrow();
    });

    it('getSupportedVersions returns all registered versions', () => {
        const r1: Router = express.Router();
        const r2: Router = express.Router();
        VersionManager.registerVersion('va', r1);
        VersionManager.registerVersion('vb', r2);
        const versions = VersionManager.getSupportedVersions();
        expect(versions).toContain('va');
        expect(versions).toContain('vb');
    });

    describe('createVersionMiddleware', () => {
        let req: any, res: any, next: jest.Mock;

        beforeEach(() => {
            req = { headers: {}, apiVersion: undefined };
            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis(),
                set: jest.fn().mockReturnThis()
            };
            next = jest.fn();
        });

        it('calls next when version is registered', () => {
            const router: Router = express.Router();
            VersionManager.registerVersion('v1', router);
            req.headers['accept-version'] = 'v1';
            const middleware = VersionManager.createVersionMiddleware();
            middleware(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(req.apiVersion).toBe('v1');
        });

        it('defaults to v1 when no accept-version header', () => {
            const router: Router = express.Router();
            VersionManager.registerVersion('v1', router);
            const middleware = VersionManager.createVersionMiddleware();
            middleware(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(req.apiVersion).toBe('v1');
        });

        it('returns 400 for unsupported version', () => {
            const middleware = VersionManager.createVersionMiddleware();
            req.headers['accept-version'] = 'v_unknown';
            middleware(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(next).not.toHaveBeenCalled();
        });

        it('sets Warning header for deprecated version', () => {
            const router: Router = express.Router();
            VersionManager.registerVersion('vdep', router);
            VersionManager.deprecateVersion('vdep', '2025-01-01');
            req.headers['accept-version'] = 'vdep';
            const middleware = VersionManager.createVersionMiddleware();
            middleware(req, res, next);
            expect(res.set).toHaveBeenCalledWith('Warning', expect.stringContaining('deprecated'));
            expect(next).toHaveBeenCalledTimes(1);
        });
    });
});
