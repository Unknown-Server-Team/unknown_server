const LogManager = require('./LogManager');
const PermissionManager = require('./PermissionManager');
const db = require('../database/db');

class RoleManager {
    async getRoles() {
        try {
            const [roles] = await db.query('SELECT * FROM roles');
            return roles;
        } catch (error) {
            LogManager.error('Failed to get roles', error);
            throw error;
        }
    }

    async getUserRoles(userId) {
        try {
            const [roles] = await db.query(`
                SELECT r.* 
                FROM roles r
                JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]);
            // Return empty array instead of undefined if no roles found
            return roles || [];
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
            return roles[0].count > 0;
        } catch (error) {
            LogManager.error('Failed to check role', error);
            throw error;
        }
    }

    async hasAnyRole(userId, roleNames) {
        try {
            const [roles] = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name IN (?)
            `, [userId, roleNames]);
            return roles[0].count > 0;
        } catch (error) {
            LogManager.error('Failed to check roles', error);
            throw error;
        }
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

    async createRole(name, description, permissions = []) {
        try {
            const result = await db.query(
                'INSERT INTO roles (name, description) VALUES (?, ?)',
                [name, description]
            );

            if (permissions.length > 0) {
                const roleId = result.insertId;
                const values = permissions.map(permissionId => [roleId, permissionId]);
                
                await db.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
                    [values]
                );
            }

            LogManager.success('Role created', { name });
            return result.insertId;
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

            await db.query('DELETE FROM roles WHERE id = ?', [roleId]);
            LogManager.info('Role deleted successfully', { roleId });
        } catch (error) {
            LogManager.error('Failed to delete role', error);
            throw error;
        }
    }

    async getRoleWithPermissions(roleId) {
        try {
            const [[role]] = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]);
            if (!role) return null;

            const permissions = await PermissionManager.getRolePermissions(roleId);
            return { ...role, permissions };
        } catch (error) {
            LogManager.error('Failed to get role with permissions', error);
            throw error;
        }
    }

    async getUserWithRolesAndPermissions(userId) {
        try {
            const roles = await this.getUserRoles(userId);
            const permissions = await PermissionManager.getUserPermissions(userId);
            
            return {
                roles,
                permissions,
                hasPermission: (permissionName) => permissions.some(p => p.name === permissionName)
            };
        } catch (error) {
            LogManager.error('Failed to get user roles and permissions', error);
            throw error;
        }
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
}

module.exports = new RoleManager();