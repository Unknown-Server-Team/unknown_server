import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest, PermissionRecord, RoleRecord } from '../types';
import type {
    QueryValue,
    RoleChangeAction,
    CountRow,
    HierarchyRow,
    UserRoleRow,
    RoleIdRow,
    RoleNameRow,
    HierarchyRoleRow,
    InsertResult,
    RoleHierarchyData,
    RoleUpdateData,
    AuditEvent,
    AuditEventMetadata
} from '../types/roleManager';
import type { LogManagerModule, PermissionManagerModule, CacheManagerModule, DatabaseModule, AuthAnalyticsModule } from '../types/modules';
import LogManagerImport from './LogManager';
import PermissionManagerImport from './PermissionManager';
import CacheManagerImport from './CacheManager';
import dbImport from '../database/db';

const LogManager = LogManagerImport as unknown as LogManagerModule;
const PermissionManager = PermissionManagerImport as unknown as PermissionManagerModule;
const CacheManager = CacheManagerImport as unknown as CacheManagerModule;
const db = dbImport as unknown as DatabaseModule;

interface UserRoleData {
    roles: RoleRecord[];
    permissions: PermissionRecord[];
    hasPermission: (permissionName: string) => boolean;
    hasRole: (roleName: string) => boolean;
}

class RoleManager {
    private CACHE_TTL: number;
    private roleHierarchy: Map<number, number[]>;

    constructor() {
        this.CACHE_TTL = 300;
        this.roleHierarchy = new Map();
        void this._initializeRoleHierarchy();
    }

    private async _initializeRoleHierarchy(): Promise<void> {
        try {
            const hierarchyData = await db.query(`
                SELECT parent_role_id, child_role_id
                FROM roles_hierarchy
            `) as HierarchyRow[];
            if (!hierarchyData[0]) {
                LogManager.debug('No role hierarchy data found');
                return;
            }

            hierarchyData.forEach((entry) => {
                if (!this.roleHierarchy.has(entry.child_role_id)) {
                    this.roleHierarchy.set(entry.child_role_id, []);
                }
                this.roleHierarchy.get(entry.child_role_id)?.push(entry.parent_role_id);
            });

            LogManager.info('Role hierarchy initialized', { hierarchySize: hierarchyData.length });
        } catch (error: unknown) {
            LogManager.error('Failed to initialize role hierarchy', error);
            this.roleHierarchy = new Map();
        }
    }

    async getRoles(): Promise<RoleRecord[]> {
        const cacheKey = 'roles:all';
        const cached = await CacheManager.get(cacheKey);
        if (cached) {
            return cached as RoleRecord[];
        }

        try {
            const roles = await db.query('SELECT * FROM roles') as RoleRecord[];
            await CacheManager.set(cacheKey, roles, this.CACHE_TTL);
            return roles;
        } catch (error: unknown) {
            LogManager.error('Failed to get roles', error);
            throw error;
        }
    }

    async getUserRoles(userId: number): Promise<RoleRecord[]> {
        const cacheKey = `user:${userId}:roles`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) {
            return cached as RoleRecord[];
        }

        try {
            const roles = await db.query(`
                SELECT r.*
                FROM roles r
                JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]) as RoleRecord[];
            const result = roles || [];
            await CacheManager.set(cacheKey, result, this.CACHE_TTL);
            return result;
        } catch (error: unknown) {
            LogManager.error('Failed to get user roles', error);
            throw error;
        }
    }

    async assignRole(userId: number, roleId: number): Promise<void> {
        try {
            await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
            await CacheManager.del(`user:${userId}:roles`);
            await CacheManager.del(`user:${userId}:permissions`);
            void this._trackRoleChange(userId, roleId, 'assign');
            LogManager.info('Role assigned successfully', { userId, roleId });
        } catch (error: unknown) {
            LogManager.error('Failed to assign role', error);
            throw error;
        }
    }

    async removeRole(userId: number, roleId: number): Promise<void> {
        try {
            await db.query('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
            await CacheManager.del(`user:${userId}:roles`);
            await CacheManager.del(`user:${userId}:permissions`);
            void this._trackRoleChange(userId, roleId, 'remove');
            LogManager.info('Role removed successfully', { userId, roleId });
        } catch (error: unknown) {
            LogManager.error('Failed to remove role', error);
            throw error;
        }
    }

    async hasRole(userId: number, roleName: string): Promise<boolean> {
        try {
            const roles = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name = ?
            `, [userId, roleName]) as CountRow[];
            if (roles[0].count > 0) {
                return true;
            }
            return this._hasRoleViaHierarchy(userId, roleName);
        } catch (error: unknown) {
            LogManager.error('Failed to check role', error);
            throw error;
        }
    }

    async hasAnyRole(userId: number, roleNames: string[]): Promise<boolean> {
        try {
            if (!roleNames || !Array.isArray(roleNames) || roleNames.length === 0) {
                return false;
            }

            const roles = await db.query(`
                SELECT COUNT(*) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ? AND r.name IN (?)
            `, [userId, roleNames]) as CountRow[];

            if (roles && roles[0] && roles[0].count > 0) {
                return true;
            }

            for (const roleName of roleNames) {
                if (await this._hasRoleViaHierarchy(userId, roleName)) {
                    return true;
                }
            }

            return false;
        } catch (error: unknown) {
            LogManager.error('Failed to check roles', error);
            return false;
        }
    }

    private async _hasRoleViaHierarchy(userId: number, roleName: string): Promise<boolean> {
        const targetRole = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]) as RoleIdRow[];
        if (!targetRole[0]) {
            return false;
        }

        const userRoles = await this.getUserRoles(userId);
        if (!userRoles.length) {
            return false;
        }

        for (const role of userRoles) {
            if (await this._checkRoleHierarchy(role.id, targetRole[0].id, new Set<number>())) {
                return true;
            }
        }

        return false;
    }

    private async _checkRoleHierarchy(roleId: number, targetRoleId: number, visited: Set<number>): Promise<boolean> {
        if (visited.has(roleId)) {
            return false;
        }
        visited.add(roleId);

        if (roleId === targetRoleId) {
            return true;
        }

        const parentRoles = this.roleHierarchy.get(roleId) || [];
        for (const parentId of parentRoles) {
            if (await this._checkRoleHierarchy(parentId, targetRoleId, visited)) {
                return true;
            }
        }

        return false;
    }

    createRoleMiddleware(roleNames: string | string[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
            try {
                if (!req.user) {
                    res.status(401).json({ error: 'Authentication required' });
                    return;
                }

                const hasAccess = await this.hasAnyRole(req.user.id, Array.isArray(roleNames) ? roleNames : [roleNames]);
                if (!hasAccess) {
                    res.status(403).json({ error: 'Insufficient permissions' });
                    return;
                }

                next();
            } catch (error: unknown) {
                LogManager.error('Role middleware error', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    async createRole(name: string, description: string, permissions: number[] = [], parentRoleId: number | null = null): Promise<number> {
        try {
            const result = await db.query(
                'INSERT INTO roles (name, description) VALUES (?, ?)',
                [name, description]
            ) as InsertResult;

            const roleId = result.insertId;

            if (permissions.length > 0) {
                const values = permissions.map((permissionId) => [roleId, permissionId] as QueryValue[]);
                await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
            }

            if (parentRoleId) {
                await db.query(
                    'INSERT INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                    [parentRoleId, roleId]
                );

                if (!this.roleHierarchy.has(roleId)) {
                    this.roleHierarchy.set(roleId, []);
                }
                this.roleHierarchy.get(roleId)?.push(parentRoleId);
            }

            await CacheManager.del('roles:all');
            LogManager.success('Role created', { name, roleId });
            return roleId;
        } catch (error: unknown) {
            LogManager.error('Failed to create role', error);
            throw error;
        }
    }

    async updateRole(roleId: number, data: RoleUpdateData): Promise<void> {
        try {
            await db.query('UPDATE roles SET name = ?, description = ? WHERE id = ?', [data.name, data.description, roleId]);

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
                        const parents = this.roleHierarchy.get(roleId);
                        if (parents) {
                            parents.length = 0;
                        }
                    }
                    this.roleHierarchy.get(roleId)?.push(data.parentRoleId);
                } else {
                    this.roleHierarchy.set(roleId, []);
                }
            }

            await CacheManager.del('roles:all');
            await CacheManager.del(`role:${roleId}`);
            await CacheManager.del(`role:${roleId}:permissions`);
            LogManager.info('Role updated successfully', { roleId });
        } catch (error: unknown) {
            LogManager.error('Failed to update role', error);
            throw error;
        }
    }

    async deleteRole(roleId: number): Promise<void> {
        try {
            const adminUsers = await db.query(`
                SELECT COUNT(DISTINCT ur.user_id) as count
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE r.name = 'admin'
            `) as CountRow[];

            if (adminUsers[0].count === 1) {
                const role = await db.query('SELECT name FROM roles WHERE id = ?', [roleId]) as RoleNameRow[];
                if (role[0]?.name === 'admin') {
                    throw new Error('Cannot delete the last admin role');
                }
            }

            const userRoles = await db.query('SELECT user_id FROM user_roles WHERE role_id = ?', [roleId]) as UserRoleRow[];
            await db.query('DELETE FROM roles WHERE id = ?', [roleId]);
            await db.query('DELETE FROM roles_hierarchy WHERE child_role_id = ? OR parent_role_id = ?', [roleId, roleId]);

            this.roleHierarchy.delete(roleId);
            this.roleHierarchy.forEach((parents) => {
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
        } catch (error: unknown) {
            LogManager.error('Failed to delete role', error);
            throw error;
        }
    }

    async getRoleWithPermissions(roleId: number): Promise<(RoleRecord & { permissions: PermissionRecord[]; parentRoles: RoleRecord[] }) | null> {
        const cacheKey = `role:${roleId}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) {
            return cached as RoleRecord & { permissions: PermissionRecord[]; parentRoles: RoleRecord[] };
        }

        try {
            const role = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]) as RoleRecord[];
            if (!role[0]) {
                return null;
            }

            const permissions = await PermissionManager.getRolePermissions(roleId);
            const parentRoleIds = this.roleHierarchy.get(roleId) || [];
            let parentRoles: RoleRecord[] = [];

            if (parentRoleIds.length > 0) {
                parentRoles = await db.query('SELECT * FROM roles WHERE id IN (?)', [parentRoleIds]) as RoleRecord[];
            }

            const result = { ...role[0], permissions: permissions as PermissionRecord[], parentRoles };
            await CacheManager.set(cacheKey, result, this.CACHE_TTL);
            return result;
        } catch (error: unknown) {
            LogManager.error('Failed to get role with permissions', error);
            throw error;
        }
    }

    async getUserWithRolesAndPermissions(userId: number): Promise<UserRoleData> {
        const rolesCacheKey = `user:${userId}:roles`;
        const permissionsCacheKey = `user:${userId}:permissions`;

        try {
            let roles = await CacheManager.get(rolesCacheKey) as RoleRecord[] | null;
            if (!roles) {
                roles = await this.getUserRoles(userId);
                await CacheManager.set(rolesCacheKey, roles, this.CACHE_TTL);
            }

            let permissions = await CacheManager.get(permissionsCacheKey) as PermissionRecord[] | null;
            if (!permissions) {
                permissions = await this._getUserEffectivePermissions(userId);
                await CacheManager.set(permissionsCacheKey, permissions, this.CACHE_TTL);
            }

            return {
                roles,
                permissions,
                hasPermission: (permissionName: string): boolean => (permissions as PermissionRecord[]).some((permission) => permission.name === permissionName),
                hasRole: (roleName: string): boolean => (roles as RoleRecord[]).some((role) => role.name === roleName)
            };
        } catch (error: unknown) {
            LogManager.error('Failed to get user roles and permissions', error);
            throw error;
        }
    }

    private async _getUserEffectivePermissions(userId: number): Promise<PermissionRecord[]> {
        try {
            const directPermissions = await db.query(`
                SELECT DISTINCT p.*
                FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = ?
            `, [userId]) as PermissionRecord[];

            const directPermsArray = Array.isArray(directPermissions) ? directPermissions : [];
            const userRoles = await this.getUserRoles(userId);
            const inheritedPermissions: PermissionRecord[] = [];

            if (Array.isArray(userRoles) && userRoles.length > 0) {
                for (const role of userRoles) {
                    const parentRoleIds = await this._getAllParentRoleIds(role.id, new Set<number>());
                    if (parentRoleIds.size > 0) {
                        const parentPermissions = await db.query(`
                            SELECT DISTINCT p.*
                            FROM permissions p
                            JOIN role_permissions rp ON p.id = rp.permission_id
                            WHERE rp.role_id IN (?)
                        `, [Array.from(parentRoleIds)]) as PermissionRecord[];

                        if (Array.isArray(parentPermissions)) {
                            inheritedPermissions.push(...parentPermissions);
                        }
                    }
                }
            }

            return [
                ...directPermsArray,
                ...inheritedPermissions.filter((inheritedPermission) => (
                    !directPermsArray.some((directPermission) => directPermission.id === inheritedPermission.id)
                ))
            ];
        } catch (error: unknown) {
            LogManager.error('Failed to get effective permissions', error);
            throw error;
        }
    }

    private async _getAllParentRoleIds(roleId: number, visited: Set<number> = new Set<number>()): Promise<Set<number>> {
        const parents = this.roleHierarchy.get(roleId) || [];
        const result = new Set<number>();

        for (const parentId of parents) {
            if (!visited.has(parentId)) {
                visited.add(parentId);
                result.add(parentId);
                const grandparents = await this._getAllParentRoleIds(parentId, visited);
                grandparents.forEach((id) => result.add(id));
            }
        }

        return result;
    }

    createRoleAndPermissionMiddleware(
        roleNames: string | string[],
        requiredPermissions: string[] = [],
        requireAll = false
    ): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
            try {
                if (!req.user) {
                    res.status(401).json({ error: 'Authentication required' });
                    return;
                }

                const hasRole = await this.hasAnyRole(req.user.id, Array.isArray(roleNames) ? roleNames : [roleNames]);
                if (!hasRole) {
                    res.status(403).json({ error: 'Insufficient role permissions' });
                    return;
                }

                if (requiredPermissions.length > 0) {
                    const hasPermissions = await PermissionManager.checkPermissions(req.user.id, requiredPermissions, requireAll);
                    if (!hasPermissions) {
                        res.status(403).json({ error: 'Insufficient permissions' });
                        return;
                    }
                }

                next();
            } catch (error: unknown) {
                LogManager.error('Role and permission middleware error', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    async getDefaultRole(): Promise<RoleRecord> {
        try {
            const cacheKey = 'role:default';
            const cached = await CacheManager.get(cacheKey);
            if (cached) {
                return cached as RoleRecord;
            }

            const role = await db.query('SELECT * FROM roles WHERE name = ?', ['user']) as RoleRecord[];

            if (!role[0]) {
                const basicRole = await db.query(`
                    SELECT r.* FROM roles r
                    LEFT JOIN role_permissions rp ON r.id = rp.role_id
                    GROUP BY r.id
                    ORDER BY COUNT(rp.permission_id) ASC
                    LIMIT 1
                `) as RoleRecord[];

                if (basicRole[0]) {
                    await CacheManager.set(cacheKey, basicRole[0], this.CACHE_TTL);
                    return basicRole[0];
                }

                const result = await db.query(
                    'INSERT INTO roles (name, description) VALUES (?, ?)',
                    ['user', 'Default user role with basic permissions']
                ) as InsertResult;

                const newRole = await db.query('SELECT * FROM roles WHERE id = ?', [result.insertId]) as RoleRecord[];
                await CacheManager.set(cacheKey, newRole[0], this.CACHE_TTL);
                return newRole[0];
            }

            await CacheManager.set(cacheKey, role[0], this.CACHE_TTL);
            return role[0];
        } catch (error: unknown) {
            LogManager.error('Failed to get default role', error);
            throw error;
        }
    }

    async getRoleHierarchy(): Promise<RoleHierarchyData[]> {
        try {
            const hierarchyData = await db.query(`
                SELECT
                    r.id, r.name, r.description,
                    p.id as parent_id, p.name as parent_name
                FROM roles r
                LEFT JOIN roles_hierarchy rh ON r.id = rh.child_role_id
                LEFT JOIN roles p ON rh.parent_role_id = p.id
                ORDER BY r.name
            `) as HierarchyRoleRow[];

            const hierarchy: Record<number, RoleHierarchyData> = {};
            hierarchyData.forEach((row) => {
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
                        name: row.parent_name || ''
                    });
                }
            });

            return Object.values(hierarchy);
        } catch (error: unknown) {
            LogManager.error('Failed to get role hierarchy', error);
            throw error;
        }
    }

    async setRoleParent(roleId: number, parentRoleId: number | null): Promise<boolean> {
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
                    const parents = this.roleHierarchy.get(roleId);
                    if (parents) {
                        parents.length = 0;
                    }
                }
                this.roleHierarchy.get(roleId)?.push(parentRoleId);
            } else {
                this.roleHierarchy.set(roleId, []);
            }

            await CacheManager.del(`role:${roleId}`);

            const userRoles = await db.query('SELECT user_id FROM user_roles WHERE role_id = ?', [roleId]) as UserRoleRow[];
            for (const { user_id } of userRoles) {
                await CacheManager.del(`user:${user_id}:permissions`);
            }

            LogManager.info('Role parent updated', { roleId, parentRoleId });
            return true;
        } catch (error: unknown) {
            LogManager.error('Failed to set role parent', error);
            throw error;
        }
    }

    private async _wouldCreateCircularReference(roleId: number, parentId: number): Promise<boolean> {
        const visited = new Set<number>();
        const checkHierarchy = async (currentId: number): Promise<boolean> => {
            if (currentId === roleId) {
                return true;
            }
            if (visited.has(currentId)) {
                return false;
            }
            visited.add(currentId);

            const children: number[] = [];
            for (const [childId, parents] of this.roleHierarchy.entries()) {
                if (parents.includes(currentId)) {
                    children.push(childId);
                }
            }

            for (const childId of children) {
                if (await checkHierarchy(childId)) {
                    return true;
                }
            }

            return false;
        };

        return checkHierarchy(parentId);
    }

    private async _trackRoleChange(userId: number, roleId: number, action: RoleChangeAction, adminId: number | null = null): Promise<void> {
        try {
            const AuthAnalytics = require('./AuthAnalytics') as AuthAnalyticsModule;
            if (AuthAnalytics && AuthAnalytics.trackRoleUsage && AuthAnalytics.logAuditEvent) {
                await AuthAnalytics.trackRoleUsage(roleId, userId);
                const metadata: AuditEventMetadata = { timestamp: Date.now(), automated: adminId === null };
                const auditEvent: AuditEvent = {
                    action_type: action === 'assign' ? 'role_assigned' : 'role_removed',
                    target_id: userId,
                    role_id: roleId,
                    metadata,
                    admin_id: adminId || 0
                };
                await AuthAnalytics.logAuditEvent(auditEvent);
            }
        } catch (error: unknown) {
            LogManager.debug('Failed to track role change', error);
        }
    }
}

type RoleManagerExport = RoleManager & {
    roleManager: RoleManager;
    default: RoleManager;
};

const roleManager = new RoleManager();
const exportedRoleManager = roleManager as RoleManagerExport;
exportedRoleManager.roleManager = roleManager;
exportedRoleManager.default = roleManager;

export = exportedRoleManager;
