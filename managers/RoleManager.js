const LogManager = require('./LogManager');
const PermissionManager = require('./PermissionManager');
const CacheManager = require('./CacheManager');
const db = require('../database/db');

class RoleManager {
    constructor() {
        this.CACHE_TTL = 300;
        this.roleHierarchy = new Map();
        this._initializeRoleHierarchy();
    }

    async _initializeRoleHierarchy() {
        try {
            const hierarchyData = await db.query(`
                SELECT parent_role_id, child_role_id
                FROM roles_hierarchy
            `);
            if (!hierarchyData[0]) return LogManager.debug('No role hierarchy data found');

            hierarchyData.forEach(entry => {
                if (!this.roleHierarchy.has(entry.child_role_id)) {
                    this.roleHierarchy.set(entry.child_role_id, []);
                }
                this.roleHierarchy.get(entry.child_role_id).push(entry.parent_role_id);
            });

            LogManager.info('Role hierarchy initialized', { hierarchySize: hierarchyData.length });
        } catch (error) {
            LogManager.error('Failed to initialize role hierarchy', error);
            this.roleHierarchy = new Map();
        }
    }

    async getRoles() {
        const cacheKey = 'roles:all';
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const [roles] = await db.query('SELECT * FROM roles');
            await CacheManager.set(cacheKey, roles, this.CACHE_TTL);
            return roles;
        } catch (error) {
            LogManager.error('Failed to get roles', error);
            throw error;
        }
    }

    async getUserRoles(userId) {
        const cacheKey = `user:${userId}:roles`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const [roles] = await db.query(`
                SELECT r.*
                FROM roles r
                JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]);

            const result = roles || [];
            await CacheManager.set(cacheKey, result, this.CACHE_TTL);
            return result;
        } catch (error) {
            LogManager.error('Failed to get user roles', error);
            throw error;
        }
    }

    async assignRole(userId, roleId) {
        try {
            await db.query(
                'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
                [userId, roleId]
            );

            await CacheManager.del(`user:${userId}:roles`);
            await CacheManager.del(`user:${userId}:permissions`);

            this._trackRoleChange(userId, roleId, 'assign');

            LogManager.info('Role assigned successfully', { userId, roleId });
        } catch (error) {
            LogManager.error('Failed to assign role', error);
            throw error;
        }
    }

    async removeRole(userId, roleId) {
        try {
            await db.query(
                'DELETE FROM user_roles WHERE user_id = ? AND role_id = ?',
                [userId, roleId]
            );

            await CacheManager.del(`user:${userId}:roles`);
            await CacheManager.del(`user:${userId}:permissions`);

            this._trackRoleChange(userId, roleId, 'remove');

            LogManager.info('Role removed successfully', { userId, roleId });
        } catch (error) {
            LogManager.error('Failed to remove role', error);
            throw error;
        }
    }

    async hasRole(userId, roleName) {
        try {
            const [roles] = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name = ?
            `, [userId, roleName]);

            if (roles[0].count > 0) return true;

            return await this._hasRoleViaHierarchy(userId, roleName);
        } catch (error) {
            LogManager.error('Failed to check role', error);
            throw error;
        }
    }

    async hasAnyRole(userId, roleNames) {
        try {
            if (!roleNames || !Array.isArray(roleNames) || roleNames.length === 0) {
                return false;
            }

            const [roles] = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name IN (?)
            `, [userId, roleNames]);

            if (roles && roles[0] && roles[0].count > 0) {
                return true;
            }

            for (const roleName of roleNames) {
                if (await this._hasRoleViaHierarchy(userId, roleName)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            LogManager.error('Failed to check roles', error);
            return false;
        }
    }

    async _hasRoleViaHierarchy(userId, roleName) {
        const [targetRole] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
        if (!targetRole) return false;

        const userRoles = await this.getUserRoles(userId);
        if (!userRoles.length) return false;

        for (const role of userRoles) {
            if (await this._checkRoleHierarchy(role.id, targetRole.id, new Set())) {
                return true;
            }
        }

        return false;
    }

    async _checkRoleHierarchy(roleId, targetRoleId, visited) {
        if (visited.has(roleId)) return false;
        visited.add(roleId);

        if (roleId === targetRoleId) return true;

        const parentRoles = this.roleHierarchy.get(roleId) || [];
        for (const parentId of parentRoles) {
            if (await this._checkRoleHierarchy(parentId, targetRoleId, visited)) {
                return true;
            }
        }

        return false;
    }

    createRoleMiddleware(roleNames) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                const hasAccess = await this.hasAnyRole(req.user.id, Array.isArray(roleNames) ? roleNames : [roleNames]);
                if (!hasAccess) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                next();
            } catch (error) {
                LogManager.error('Role middleware error', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    async createRole(name, description, permissions = [], parentRoleId = null) {
        try {
            const result = await db.query(
                'INSERT INTO roles (name, description) VALUES (?, ?)',
                [name, description]
            );

            const roleId = result.insertId;

            if (permissions.length > 0) {
                const values = permissions.map(permissionId => [roleId, permissionId]);

                await db.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
                    [values]
                );
            }

            if (parentRoleId) {
                await db.query(
                    'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                    [parentRoleId, roleId]
                );

                if (!this.roleHierarchy.has(roleId)) {
                    this.roleHierarchy.set(roleId, []);
                }
                this.roleHierarchy.get(roleId).push(parentRoleId);
            }

            await CacheManager.del('roles:all');

            LogManager.success('Role created', { name, roleId });
            return roleId;
        } catch (error) {
            LogManager.error('Failed to create role', error);
            throw error;
        }
    }

    async updateRole(roleId, data) {
        try {
            await db.query(
                'UPDATE roles SET name = ?, description = ? WHERE id = ?',
                [data.name, data.description, roleId]
            );

            if (data.permissions) {
                await db.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

                for (const permissionId of data.permissions) {
                    await PermissionManager.assignPermissionToRole(roleId, permissionId);
                }
            }

            if (data.parentRoleId !== undefined) {
                await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ?', [roleId]);

                if (data.parentRoleId !== null) {
                    await db.query(
                        'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                        [data.parentRoleId, roleId]
                    );

                    if (!this.roleHierarchy.has(roleId)) {
                        this.roleHierarchy.set(roleId, []);
                    } else {
                        this.roleHierarchy.get(roleId).length = 0;
                    }
                    this.roleHierarchy.get(roleId).push(data.parentRoleId);
                } else {
                    this.roleHierarchy.set(roleId, []);
                }
            }

            await CacheManager.del('roles:all');
            await CacheManager.del(`role:${roleId}`);
            await CacheManager.del(`role:${roleId}:permissions`);

            LogManager.info('Role updated successfully', { roleId });
        } catch (error) {
            LogManager.error('Failed to update role', error);
            throw error;
        }
    }

    async deleteRole(roleId) {
        try {
            const [adminUsers] = await db.query(`
                SELECT COUNT(DISTINCT ur.user_id) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE r.name = 'admin'
            `);

            if (adminUsers[0].count === 1) {
                const [role] = await db.query('SELECT name FROM roles WHERE id = ?', [roleId]);
                if (role[0]?.name === 'admin') {
                    throw new Error('Cannot delete the last admin role');
                }
            }

            const [userRoles] = await db.query('SELECT user_id FROM user_roles WHERE role_id = ?', [roleId]);

            await db.query('DELETE FROM roles WHERE id = ?', [roleId]);

            await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ? OR parent_role_id = ?', [roleId, roleId]);

            this.roleHierarchy.delete(roleId);
            this.roleHierarchy.forEach((parents, id) => {
                const index = parents.indexOf(roleId);
                if (index !== -1) {
                    parents.splice(index, 1);
                }
            });

            await CacheManager.del('roles:all');
            await CacheManager.del(`role:${roleId}`);
            await CacheManager.del(`role:${roleId}:permissions`);

            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:roles`);
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info('Role deleted successfully', { roleId });
        } catch (error) {
            LogManager.error('Failed to delete role', error);
            throw error;
        }
    }

    async getRoleWithPermissions(roleId) {
        const cacheKey = `role:${roleId}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const [role] = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]);
            if (!role) return null;

            const permissions = await PermissionManager.getRolePermissions(roleId);

            const parentRoleIds = this.roleHierarchy.get(roleId) || [];
            let parentRoles = [];

            if (parentRoleIds.length > 0) {
                const [parents] = await db.query('SELECT * FROM roles WHERE id IN (?)', [parentRoleIds]);
                parentRoles = parents || [];
            }

            const result = { ...role, permissions, parentRoles };
            await CacheManager.set(cacheKey, result, this.CACHE_TTL);
            return result;
        } catch (error) {
            LogManager.error('Failed to get role with permissions', error);
            throw error;
        }
    }

    async getUserWithRolesAndPermissions(userId) {
        const rolesCacheKey = `user:${userId}:roles`;
        const permissionsCacheKey = `user:${userId}:permissions`;

        try {
            let roles = await CacheManager.get(rolesCacheKey);
            if (!roles) {
                roles = await this.getUserRoles(userId);
                await CacheManager.set(rolesCacheKey, roles, this.CACHE_TTL);
            }

            let permissions = await CacheManager.get(permissionsCacheKey);
            if (!permissions) {
                permissions = await this._getUserEffectivePermissions(userId);
                await CacheManager.set(permissionsCacheKey, permissions, this.CACHE_TTL);
            }

            return {
                roles,
                permissions,
                hasPermission: (permissionName) => permissions.some(p => p.name === permissionName),
                hasRole: (roleName) => roles.some(r => r.name === roleName)
            };
        } catch (error) {
            LogManager.error('Failed to get user roles and permissions', error);
            throw error;
        }
    }

    async _getUserEffectivePermissions(userId) {
        try {
            const [directPermissions] = await db.query(`
                SELECT DISTINCT p.*
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]);

            const directPermsArray = Array.isArray(directPermissions) ? directPermissions : [];

            const userRoles = await this.getUserRoles(userId);

            const inheritedPermissions = [];
            if (Array.isArray(userRoles) && userRoles.length > 0) {
                for (const role of userRoles) {
                    const roleId = role.id;
                    const parentRoleIds = await this._getAllParentRoleIds(roleId, new Set());

                    if (parentRoleIds.size > 0) {
                        const [parentPermissions] = await db.query(`
                            SELECT DISTINCT p.*
                            FROM permissions p
                            JOIN role_permissions rp ON p.id = rp.permission_id
                            WHERE rp.role_id IN (?)
                        `, [Array.from(parentRoleIds)]);

                        if (Array.isArray(parentPermissions)) {
                            inheritedPermissions.push(...parentPermissions);
                        }
                    }
                }
            }

            const allPermissions = [
                ...directPermsArray,
                ...inheritedPermissions.filter(inhP =>
                    !directPermsArray.some(dirP => dirP.id === inhP.id)
                )
            ];

            return allPermissions;
        } catch (error) {
            LogManager.error('Failed to get effective permissions', error);
            throw error;
        }
    }

    async _getAllParentRoleIds(roleId, visited = new Set()) {
        const parents = this.roleHierarchy.get(roleId) || [];
        const result = new Set();

        for (const parentId of parents) {
            if (!visited.has(parentId)) {
                visited.add(parentId);
                result.add(parentId);

                const grandparents = await this._getAllParentRoleIds(parentId, visited);
                grandparents.forEach(id => result.add(id));
            }
        }

        return result;
    }

    createRoleAndPermissionMiddleware(roleNames, requiredPermissions = [], requireAll = false) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                const hasRole = await this.hasAnyRole(req.user.id, Array.isArray(roleNames) ? roleNames : [roleNames]);
                if (!hasRole) {
                    return res.status(403).json({ error: 'Insufficient role permissions' });
                }

                if (requiredPermissions.length > 0) {
                    const hasPermissions = await PermissionManager.checkPermissions(
                        req.user.id,
                        requiredPermissions,
                        requireAll
                    );
                    if (!hasPermissions) {
                        return res.status(403).json({ error: 'Insufficient permissions' });
                    }
                }

                next();
            } catch (error) {
                LogManager.error('Role and permission middleware error', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    async getDefaultRole() {
        try {
            const cacheKey = 'role:default';
            const cached = await CacheManager.get(cacheKey);
            if (cached) return cached;

            const [role] = await db.query('SELECT * FROM roles WHERE name = ?', ['user']);

            if (!role) {
                const [basicRole] = await db.query(`
                    SELECT r.* FROM roles r
                    LEFT JOIN role_permissions rp ON r.id = rp.role_id
                    GROUP BY r.id
                    ORDER BY COUNT(rp.permission_id) ASC
                    LIMIT 1
                `);

                if (basicRole) {
                    await CacheManager.set(cacheKey, basicRole, this.CACHE_TTL);
                    return basicRole;
                }

                const result = await db.query(
                    'INSERT INTO roles (name, description) VALUES (?, ?)',
                    ['user', 'Default user role with basic permissions']
                );

                const [newRole] = await db.query('SELECT * FROM roles WHERE id = ?', [result.insertId]);
                await CacheManager.set(cacheKey, newRole, this.CACHE_TTL);
                return newRole;
            }

            await CacheManager.set(cacheKey, role, this.CACHE_TTL);
            return role;
        } catch (error) {
            LogManager.error('Failed to get default role', error);
            throw error;
        }
    }

    async getRoleHierarchy() {
        try {
            const [hierarchyData] = await db.query(`
                SELECT
                    r.id, r.name, r.description,
                    p.id as parent_id, p.name as parent_name
                FROM roles r
                LEFT JOIN roles_hierarchy rh ON r.id = rh.child_role_id
                LEFT JOIN roles p ON rh.parent_role_id = p.id
                ORDER BY r.name
            `);

            const hierarchy = {};
            hierarchyData.forEach(row => {
                if (!hierarchy[row.id]) {
                    hierarchy[row.id] = {
                        id: row.id,
                        name: row.name,
                        description: row.description,
                        parents: []
                    };
                }

                if (row.parent_id) {
                    hierarchy[row.id].parents.push({
                        id: row.parent_id,
                        name: row.parent_name
                    });
                }
            });

            return Object.values(hierarchy);
        } catch (error) {
            LogManager.error('Failed to get role hierarchy', error);
            throw error;
        }
    }

    async setRoleParent(roleId, parentRoleId) {
        try {
            if (parentRoleId && await this._wouldCreateCircularReference(roleId, parentRoleId)) {
                throw new Error('This would create a circular hierarchy');
            }

            await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ?', [roleId]);

            if (parentRoleId) {
                await db.query(
                    'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                    [parentRoleId, roleId]
                );

                if (!this.roleHierarchy.has(roleId)) {
                    this.roleHierarchy.set(roleId, []);
                } else {
                    this.roleHierarchy.get(roleId).length = 0;
                }
                this.roleHierarchy.get(roleId).push(parentRoleId);
            } else {
                this.roleHierarchy.set(roleId, []);
            }

            await CacheManager.del(`role:${roleId}`);

            const [userRoles] = await db.query('SELECT user_id FROM user_roles WHERE role_id = ?', [roleId]);
            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info(`Role parent updated`, { roleId, parentRoleId });
            return true;
        } catch (error) {
            LogManager.error('Failed to set role parent', error);
            throw error;
        }
    }

    async _wouldCreateCircularReference(roleId, parentId) {
        const visited = new Set();
        const checkHierarchy = async (currentId) => {
            if (currentId === roleId) return true;
            if (visited.has(currentId)) return false;
            visited.add(currentId);

            const children = [];
            for (const [childId, parents] of this.roleHierarchy.entries()) {
                if (parents.includes(currentId)) {
                    children.push(childId);
                }
            }

            for (const childId of children) {
                if (await checkHierarchy(childId)) return true;
            }

            return false;
        };

        return await checkHierarchy(parentId);
    }

    async _trackRoleChange(userId, roleId, action, adminId = null) {
        try {
            const AuthAnalytics = require('./AuthAnalytics');
            if (AuthAnalytics && AuthAnalytics.trackRoleUsage) {
                await AuthAnalytics.trackRoleUsage(roleId, userId);

                await AuthAnalytics.logAuditEvent({
                    action_type: action === 'assign' ? 'role_assigned' : 'role_removed',
                    target_id: userId,
                    role_id: roleId,
                    metadata: { timestamp: Date.now(), automated: adminId === null },
                    admin_id: adminId || 0
                });
            }
        } catch (error) {
            LogManager.debug('Failed to track role change', error);
        }
    }
}

module.exports = new RoleManager();