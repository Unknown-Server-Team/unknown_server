import type { NextFunction, Response } from 'express';
import type {
    PermissionRecord,
    UserRoleRow,
    CountRow,
    PermissionMiddlewareOptions,
    PermissionRequest
} from '../types/permission';
import type { CacheManagerModule, DatabaseModule } from '../types/modules';
import LogManager from './LogManager';
import CacheManagerImport from './CacheManager';
import dbImport from '../database/db';

const CacheManager = CacheManagerImport as unknown as CacheManagerModule;
const db = dbImport as unknown as DatabaseModule;

class PermissionManager {
    private readonly CACHE_TTL: number;

    constructor() {
        this.CACHE_TTL = 300;
    }

    async getPermissions(): Promise<PermissionRecord[]> {
        const cacheKey = 'permissions:all';
        const cached = await CacheManager.get<PermissionRecord[]>(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const [permissions] = await db.query<[PermissionRecord[]]>('SELECT * FROM permissions');
            await CacheManager.set(cacheKey, permissions, this.CACHE_TTL);
            return permissions;
        } catch (error: unknown) {
            LogManager.error('Failed to get permissions', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async getRolePermissions(roleId: number): Promise<PermissionRecord[]> {
        const cacheKey = `role:${roleId}:permissions`;
        const cached = await CacheManager.get<PermissionRecord[]>(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const [permissions] = await db.query<[PermissionRecord[]]>(
                `
                SELECT p.*
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                WHERE rp.role_id = ?
            `,
                [roleId]
            );
            await CacheManager.set(cacheKey, permissions, this.CACHE_TTL);
            return permissions;
        } catch (error: unknown) {
            LogManager.error('Failed to get role permissions', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async getUserPermissions(userId: number): Promise<PermissionRecord[]> {
        const cacheKey = `user:${userId}:permissions`;
        const cached = await CacheManager.get<PermissionRecord[]>(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const [permissions] = await db.query<[PermissionRecord[]]>(
                `
                SELECT DISTINCT p.*
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ?
            `,
                [userId]
            );
            await CacheManager.set(cacheKey, permissions, this.CACHE_TTL);
            return permissions;
        } catch (error: unknown) {
            LogManager.error('Failed to get user permissions', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async hasPermission(userId: number, permissionName: string): Promise<boolean> {
        try {
            const [result] = await db.query<[CountRow[]]>(
                `
                SELECT COUNT(*) as count
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ? AND p.name = ?
            `,
                [userId, permissionName]
            );
            return result[0].count > 0;
        } catch (error: unknown) {
            LogManager.error('Failed to check permission', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async hasAnyPermission(userId: number, permissionNames: string[]): Promise<boolean> {
        try {
            const [result] = await db.query<[CountRow[]]>(
                `
                SELECT COUNT(*) as count
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ? AND p.name IN (?)
            `,
                [userId, permissionNames]
            );
            return result[0].count > 0;
        } catch (error: unknown) {
            LogManager.error('Failed to check permissions', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async assignPermissionToRole(roleId: number, permissionId: number): Promise<void> {
        try {
            await db.query(
                'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                [roleId, permissionId]
            );

            await CacheManager.del(`role:${roleId}:permissions`);
            const [userRoles] = await db.query<[UserRoleRow[]]>(
                'SELECT user_id FROM user_roles WHERE role_id = ?',
                [roleId]
            );
            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info('Permission assigned to role', { roleId, permissionId });
        } catch (error: unknown) {
            LogManager.error('Failed to assign permission to role', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async removePermissionFromRole(roleId: number, permissionId: number): Promise<void> {
        try {
            await db.query(
                'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
                [roleId, permissionId]
            );

            await CacheManager.del(`role:${roleId}:permissions`);
            const [userRoles] = await db.query<[UserRoleRow[]]>(
                'SELECT user_id FROM user_roles WHERE role_id = ?',
                [roleId]
            );
            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info('Permission removed from role', { roleId, permissionId });
        } catch (error: unknown) {
            LogManager.error('Failed to remove permission from role', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    createPermissionMiddleware(permissions: string[] | string, options: PermissionMiddlewareOptions = { requireAll: false }): (req: PermissionRequest, res: Response, next: NextFunction) => Promise<Response | void> {
        return async (req: PermissionRequest, res: Response, next: NextFunction): Promise<Response | void> => {
            try {
                if (!req.user) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                const hasPermissions = await this.checkPermissions(
                    req.user.id,
                    Array.isArray(permissions) ? permissions : [permissions],
                    options.requireAll
                );

                if (!hasPermissions) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                if (!req.permissions) {
                    req.permissions = await this.getUserPermissions(req.user.id);
                }

                next();
            } catch (error: unknown) {
                LogManager.error('Permission middleware error', error instanceof Error ? error : new Error(String(error)));
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    async cacheUserPermissions(userId: number): Promise<PermissionRecord[]> {
        try {
            return await this.getUserPermissions(userId);
        } catch (error: unknown) {
            LogManager.error('Failed to cache user permissions', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async checkPermissions(userId: number, requiredPermissions: string[], requireAll: boolean = false): Promise<boolean> {
        try {
            const userPermissions = await this.getUserPermissions(userId);
            const userPermissionNames = userPermissions.map((permission: PermissionRecord): string => permission.name);

            if (requireAll) {
                return requiredPermissions.every((permission: string): boolean => userPermissionNames.includes(permission));
            }

            return requiredPermissions.some((permission: string): boolean => userPermissionNames.includes(permission));
        } catch (error: unknown) {
            LogManager.error('Failed to check multiple permissions', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }
}

const permissionManager = new PermissionManager();

export = permissionManager;
