const LogManager = require('./LogManager');
const PermissionManager = require('./PermissionManager');
const CacheManager = require('./CacheManager');
const db = require('../database/db');

class RoleManager {
    constructor() {
        this.CACHE_TTL = 300; // 5 minutes
        this.roleHierarchy = new Map();
        this._initializeRoleHierarchy();
    }

    // Initialize role hierarchy from database
    async _initializeRoleHierarchy() {
        try {
            const [hierarchyData] = await db.query(`
                SELECT parent_role_id, child_role_id 
                FROM roles_hierarchy
            `);
            if (!hierarchyData) return LogManager.debug('No role hierarchy data found');
            
            // Build hierarchy map
            hierarchyData.forEach(entry => {
                if (!this.roleHierarchy.has(entry.child_role_id)) {
                    this.roleHierarchy.set(entry.child_role_id, []);
                }
                this.roleHierarchy.get(entry.child_role_id).push(entry.parent_role_id);
            });
            
            LogManager.info('Role hierarchy initialized', { hierarchySize: hierarchyData.length });
        } catch (error) {
            LogManager.error('Failed to initialize role hierarchy', error);
            // Initialize with empty hierarchy if failed
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
            
            // Return empty array instead of undefined if no roles found
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
            
            // Invalidate user role cache
            await CacheManager.del(`user:${userId}:roles`);
            await CacheManager.del(`user:${userId}:permissions`);
            
            // Log analytics event
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
            
            // Invalidate user role cache
            await CacheManager.del(`user:${userId}:roles`);
            await CacheManager.del(`user:${userId}:permissions`);
            
            // Log analytics event
            this._trackRoleChange(userId, roleId, 'remove');
            
            LogManager.info('Role removed successfully', { userId, roleId });
        } catch (error) {
            LogManager.error('Failed to remove role', error);
            throw error;
        }
    }

    async hasRole(userId, roleName) {
        try {
            // First check explicit roles assigned to user
            const [roles] = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name = ?
            `, [userId, roleName]);
            
            if (roles[0].count > 0) return true;
            
            // If not found, check inherited roles through hierarchy
            return await this._hasRoleViaHierarchy(userId, roleName);
        } catch (error) {
            LogManager.error('Failed to check role', error);
            throw error;
        }
    }

    async hasAnyRole(userId, roleNames) {
        try {
            // Handle the case when roleNames is empty or not an array
            if (!roleNames || !Array.isArray(roleNames) || roleNames.length === 0) {
                return false;
            }
            
            // First check explicit roles
            const [roles] = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name IN (?)
            `, [userId, roleNames]);
            
            // Check if the result exists and has the expected structure
            if (roles && roles[0] && roles[0].count > 0) {
                return true;
            }
            
            // Check inherited roles
            for (const roleName of roleNames) {
                if (await this._hasRoleViaHierarchy(userId, roleName)) {
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            LogManager.error('Failed to check roles', error);
            // Return false instead of throwing to make the function more robust
            return false;
        }
    }

    async _hasRoleViaHierarchy(userId, roleName) {
        // Get target role ID
        const [targetRole] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
        if (!targetRole) return false;
        
        // Get user's direct roles
        const userRoles = await this.getUserRoles(userId);
        if (!userRoles.length) return false;
        
        // Check each user role through hierarchy
        for (const role of userRoles) {
            if (await this._checkRoleHierarchy(role.id, targetRole.id, new Set())) {
                return true;
            }
        }
        
        return false;
    }
    
    async _checkRoleHierarchy(roleId, targetRoleId, visited) {
        // Prevent infinite recursion
        if (visited.has(roleId)) return false;
        visited.add(roleId);
        
        // Direct match
        if (roleId === targetRoleId) return true;
        
        // Check parents from the hierarchy map
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
            
            // Add role hierarchy if parent role specified
            if (parentRoleId) {
                await db.query(
                    'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                    [parentRoleId, roleId]
                );
                
                // Update local hierarchy map
                if (!this.roleHierarchy.has(roleId)) {
                    this.roleHierarchy.set(roleId, []);
                }
                this.roleHierarchy.get(roleId).push(parentRoleId);
            }
            
            // Invalidate roles cache
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
                // Remove existing permissions
                await db.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
                
                // Assign new permissions
                for (const permissionId of data.permissions) {
                    await PermissionManager.assignPermissionToRole(roleId, permissionId);
                }
            }
            
            // Update role hierarchy if parentRoleId is specified
            if (data.parentRoleId !== undefined) {
                // First remove existing parent relationships for this role
                await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ?', [roleId]);
                
                // Add new parent relationship if not null
                if (data.parentRoleId !== null) {
                    await db.query(
                        'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                        [data.parentRoleId, roleId]
                    );
                    
                    // Update local hierarchy map
                    if (!this.roleHierarchy.has(roleId)) {
                        this.roleHierarchy.set(roleId, []);
                    } else {
                        this.roleHierarchy.get(roleId).length = 0; // Clear existing parents
                    }
                    this.roleHierarchy.get(roleId).push(data.parentRoleId);
                } else {
                    // Remove from local hierarchy map if parentRoleId is null
                    this.roleHierarchy.set(roleId, []);
                }
            }
            
            // Invalidate caches
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
            // Check if it's the last admin role
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
            
            // Get users with this role for cache invalidation
            const [userRoles] = await db.query('SELECT user_id FROM user_roles WHERE role_id = ?', [roleId]);
            
            // Delete role (cascade will handle role_permissions and user_roles)
            await db.query('DELETE FROM roles WHERE id = ?', [roleId]);
            
            // Delete from role hierarchy
            await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ? OR parent_role_id = ?', [roleId, roleId]);
            
            // Update local hierarchy map
            this.roleHierarchy.delete(roleId);
            this.roleHierarchy.forEach((parents, id) => {
                const index = parents.indexOf(roleId);
                if (index !== -1) {
                    parents.splice(index, 1);
                }
            });
            
            // Invalidate caches
            await CacheManager.del('roles:all');
            await CacheManager.del(`role:${roleId}`);
            await CacheManager.del(`role:${roleId}:permissions`);
            
            // Invalidate user role caches
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
            
            // Get parent roles if in hierarchy
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
            // Get roles with caching
            let roles = await CacheManager.get(rolesCacheKey);
            if (!roles) {
                roles = await this.getUserRoles(userId);
                await CacheManager.set(rolesCacheKey, roles, this.CACHE_TTL);
            }
            
            // Get permissions with caching
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
            // First get user's direct permissions through their roles
            const [directPermissions] = await db.query(`
                SELECT DISTINCT p.* 
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]);
            
            // Ensure directPermissions is an array
            const directPermsArray = Array.isArray(directPermissions) ? directPermissions : [];
            
            // Get user roles
            const userRoles = await this.getUserRoles(userId);
            
            // Now get permissions inherited through the role hierarchy
            const inheritedPermissions = [];
            // Ensure userRoles is an array before iterating
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
            
            // Combine direct and inherited permissions, removing duplicates
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
                
                // Recursively get grandparent roles
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
            
            // Try to get the default 'user' role
            const [role] = await db.query('SELECT * FROM roles WHERE name = ?', ['user']);
            
            // If not found, get any role with minimal permissions
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
                
                // If no roles exist at all, create the default user role
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
    
    // Get role hierarchy
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
            
            // Group by role
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
            // Check for circular references
            if (parentRoleId && await this._wouldCreateCircularReference(roleId, parentRoleId)) {
                throw new Error('This would create a circular hierarchy');
            }
            
            // Remove existing parent relationship
            await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ?', [roleId]);
            
            // Add new parent if not null
            if (parentRoleId) {
                await db.query(
                    'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                    [parentRoleId, roleId]
                );
                
                // Update local hierarchy
                if (!this.roleHierarchy.has(roleId)) {
                    this.roleHierarchy.set(roleId, []);
                } else {
                    this.roleHierarchy.get(roleId).length = 0;
                }
                this.roleHierarchy.get(roleId).push(parentRoleId);
            } else {
                // Clear local hierarchy
                this.roleHierarchy.set(roleId, []);
            }
            
            // Invalidate caches
            await CacheManager.del(`role:${roleId}`);
            
            // Invalidate user permission caches that might be affected
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
        // If the proposed parent is actually a child or descendant of the role,
        // it would create a circular reference
        const visited = new Set();
        const checkHierarchy = async (currentId) => {
            if (currentId === roleId) return true; // Found a circle
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
    
    // Track role changes for analytics
    async _trackRoleChange(userId, roleId, action, adminId = null) {
        try {
            // If AuthAnalytics is available, log the event
            const AuthAnalytics = require('./AuthAnalytics');
            if (AuthAnalytics && AuthAnalytics.trackRoleUsage) {
                await AuthAnalytics.trackRoleUsage(roleId, userId);
                
                // Log audit event with null admin_id being valid
                await AuthAnalytics.logAuditEvent({
                    action_type: action === 'assign' ? 'role_assigned' : 'role_removed',
                    target_id: userId,
                    role_id: roleId,
                    metadata: { timestamp: Date.now(), automated: adminId === null },
                    admin_id: adminId || 0 // Use 0 as a default for system actions
                });
            }
        } catch (error) {
            // Don't let analytics failures block the main operation
            LogManager.debug('Failed to track role change', error);
        }
    }
}

module.exports = new RoleManager();