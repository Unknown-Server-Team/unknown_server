const LogManager = require('./LogManager');
const CacheManager = require('./CacheManager');
const db = require('../database/db');

class PermissionManager {
    constructor() {
        this.CACHE_TTL = 300; // 5 minutes
    }

    async getPermissions() {
        const cacheKey = 'permissions:all';
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const [permissions] = await db.query('SELECT * FROM permissions');
            await CacheManager.set(cacheKey, permissions, this.CACHE_TTL);
            return permissions;
        } catch (error) {
            LogManager.error('Failed to get permissions', error);
            throw error;
        }
    }

    async getRolePermissions(roleId) {
        const cacheKey = `role:${roleId}:permissions`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const [permissions] = await db.query(`
                SELECT p.* 
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                WHERE rp.role_id = ?
            `, [roleId]);
            
            await CacheManager.set(cacheKey, permissions, this.CACHE_TTL);
            return permissions;
        } catch (error) {
            LogManager.error('Failed to get role permissions', error);
            throw error;
        }
    }

    async getUserPermissions(userId) {
        const cacheKey = `user:${userId}:permissions`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const [permissions] = await db.query(`
                SELECT DISTINCT p.* 
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]);
            
            await CacheManager.set(cacheKey, permissions, this.CACHE_TTL);
            return permissions;
        } catch (error) {
            LogManager.error('Failed to get user permissions', error);
            throw error;
        }
    }

    async hasPermission(userId, permissionName) {
        try {
            const [result] = await db.query(`
                SELECT COUNT(*) as count
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ? AND p.name = ?
            `, [userId, permissionName]);
            return result[0].count > 0;
        } catch (error) {
            LogManager.error('Failed to check permission', error);
            throw error;
        }
    }

    async hasAnyPermission(userId, permissionNames) {
        try {
            const [result] = await db.query(`
                SELECT COUNT(*) as count
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ? AND p.name IN (?)
            `, [userId, permissionNames]);
            return result[0].count > 0;
        } catch (error) {
            LogManager.error('Failed to check permissions', error);
            throw error;
        }
    }

    async assignPermissionToRole(roleId, permissionId) {
        try {
            await db.query(
                'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                [roleId, permissionId]
            );
            
            // Invalidate related caches
            await CacheManager.del(`role:${roleId}:permissions`);
            const [userRoles] = await db.query(
                'SELECT user_id FROM user_roles WHERE role_id = ?',
                [roleId]
            );
            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info('Permission assigned to role', { roleId, permissionId });
        } catch (error) {
            LogManager.error('Failed to assign permission to role', error);
            throw error;
        }
    }

    async removePermissionFromRole(roleId, permissionId) {
        try {
            await db.query(
                'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
                [roleId, permissionId]
            );
            
            // Invalidate related caches
            await CacheManager.del(`role:${roleId}:permissions`);
            const [userRoles] = await db.query(
                'SELECT user_id FROM user_roles WHERE role_id = ?',
                [roleId]
            );
            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info('Permission removed from role', { roleId, permissionId });
        } catch (error) {
            LogManager.error('Failed to remove permission from role', error);
            throw error;
        }
    }

    createPermissionMiddleware(permissions, options = { requireAll: false }) {
        return async (req, res, next) => {
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

                // Cache permissions in request for subsequent middleware
                if (!req.permissions) {
                    req.permissions = await this.getUserPermissions(req.user.id);
                }

                next();
            } catch (error) {
                LogManager.error('Permission middleware error', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Cache user permissions for performance
    async cacheUserPermissions(userId) {
        try {
            const permissions = await this.getUserPermissions(userId);
            const cacheKey = `user:${userId}:permissions`;
            // Assuming you have a cache manager, you would use it here
            // await CacheManager.set(cacheKey, permissions, '5m');
            return permissions;
        } catch (error) {
            LogManager.error('Failed to cache user permissions', error);
            throw error;
        }
    }

    // Utility method to check multiple permissions at once
    async checkPermissions(userId, requiredPermissions, requireAll = false) {
        try {
            const userPermissions = await this.getUserPermissions(userId);
            const userPermissionNames = userPermissions.map(p => p.name);

            if (requireAll) {
                return requiredPermissions.every(p => userPermissionNames.includes(p));
            } else {
                return requiredPermissions.some(p => userPermissionNames.includes(p));
            }
        } catch (error) {
            LogManager.error('Failed to check multiple permissions', error);
            throw error;
        }
    }
}

module.exports = new PermissionManager();