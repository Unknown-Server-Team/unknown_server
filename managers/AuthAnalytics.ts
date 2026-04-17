import type {
    UsageCacheEntry,
    AnalyticsCache,
    AuditEventData,
    AuditFilters,
    PaginationOptions,
    AuditLogResult,
    RoleAnalyticsRow,
    PermissionAnalyticsRow,
    RoleUsageRow,
    PermissionUsageRow,
    AuditActivityRow,
    AnalyticsReport,
    QueryValue
} from '../types/analytics';
import type { LogManagerModule, CacheManagerModule, DatabaseModule } from '../types/modules';

const LogManager = require('./LogManager') as LogManagerModule;
const db = require('../database/db') as DatabaseModule;
const CacheManager = require('./CacheManager') as CacheManagerModule;

class AuthAnalytics {
    private analyticsCache: AnalyticsCache;
    private flushInterval: number;

    constructor() {
        this.analyticsCache = {
            roleUsage: new Map<string, UsageCacheEntry>(),
            permissionUsage: new Map<string, UsageCacheEntry>(),
            userActivity: new Map<string, unknown>()
        };
        this.flushInterval = 5 * 60 * 1000;
        this.startPeriodicFlush();
    }

    async trackRoleUsage(roleId: number, userId: number): Promise<void> {
        const key = `role:${roleId}`;
        const usage = this.analyticsCache.roleUsage.get(key) || { count: 0, users: new Set<number>() };
        usage.count++;
        usage.users.add(userId);
        this.analyticsCache.roleUsage.set(key, usage);
    }

    async trackPermissionUse(permissionId: number, userId: number): Promise<void> {
        const key = `permission:${permissionId}`;
        const usage = this.analyticsCache.permissionUsage.get(key) || { count: 0, users: new Set<number>() };
        usage.count++;
        usage.users.add(userId);
        this.analyticsCache.permissionUsage.set(key, usage);
    }

    async logAuditEvent(data: AuditEventData): Promise<void> {
        try {
            await db.query(
                `
                INSERT INTO auth_audit_log
                (action_type, admin_id, target_id, role_id, permission_id, metadata, ip_address)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
                [
                    data.action_type,
                    data.admin_id,
                    data.target_id,
                    data.role_id ?? null,
                    data.permission_id ?? null,
                    JSON.stringify(data.metadata || {}),
                    data.ip_address ?? null
                ]
            );
        } catch (error: unknown) {
            LogManager.error('Failed to log audit event', error);
        }
    }

    async getAuditLog<RowType extends Record<string, unknown>>(filters: AuditFilters = {}, pagination: PaginationOptions = { page: 1, limit: 20 }): Promise<AuditLogResult<RowType>> {
        const conditions: string[] = [];
        const params: QueryValue[] = [];

        if (filters.action_type) {
            conditions.push('action_type = ?');
            params.push(filters.action_type);
        }

        if (filters.admin_id) {
            conditions.push('admin_id = ?');
            params.push(filters.admin_id);
        }

        if (filters.target_id) {
            conditions.push('target_id = ?');
            params.push(filters.target_id);
        }

        if (filters.dateFrom) {
            conditions.push('created_at >= ?');
            params.push(filters.dateFrom as QueryValue);
        }

        if (filters.dateTo) {
            conditions.push('created_at <= ?');
            params.push(filters.dateTo as QueryValue);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = (pagination.page - 1) * pagination.limit;

        const [rows] = await db.query<[RowType[]]>(
            `
            SELECT * FROM auth_audit_log
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `,
            [...params, pagination.limit, offset]
        );

        const [[{ total }]] = await db.query<[[{ total: number }]]>(
            `
            SELECT COUNT(*) as total FROM auth_audit_log ${whereClause}
        `,
            params
        );

        return {
            data: rows,
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total,
                pages: Math.ceil(total / pagination.limit)
            }
        };
    }

    async getRoleAnalytics(roleId: number | null = null): Promise<RoleAnalyticsRow[]> {
        const cacheKey = `analytics:role:${roleId || 'all'}`;
        const cached = await CacheManager.get<RoleAnalyticsRow[]>(cacheKey);
        if (cached) {
            return cached;
        }

        const query = roleId ? 'SELECT * FROM role_analytics WHERE role_id = ?' : 'SELECT * FROM role_analytics';
        const [data] = await db.query<[RoleAnalyticsRow[]]>(query, roleId ? [roleId] : []);
        await CacheManager.set(cacheKey, data, 300);
        return data;
    }

    async getPermissionAnalytics(permissionId: number | null = null): Promise<PermissionAnalyticsRow[]> {
        const cacheKey = `analytics:permission:${permissionId || 'all'}`;
        const cached = await CacheManager.get<PermissionAnalyticsRow[]>(cacheKey);
        if (cached) {
            return cached;
        }

        const query = permissionId ? 'SELECT * FROM permission_analytics WHERE permission_id = ?' : 'SELECT * FROM permission_analytics';
        const [data] = await db.query<[PermissionAnalyticsRow[]]>(query, permissionId ? [permissionId] : []);
        await CacheManager.set(cacheKey, data, 300);
        return data;
    }

    async getMostUsedRoles(limit: number = 10): Promise<RoleUsageRow[]> {
        const [roles] = await db.query<[RoleUsageRow[]]>(
            `
            SELECT r.name, ra.total_users, ra.total_actions, ra.last_used
            FROM role_analytics ra
            JOIN roles r ON r.id = ra.role_id
            ORDER BY ra.total_actions DESC
            LIMIT ?
        `,
            [limit]
        );
        return roles;
    }

    async getMostUsedPermissions(limit: number = 10): Promise<PermissionUsageRow[]> {
        const [permissions] = await db.query<[PermissionUsageRow[]]>(
            `
            SELECT p.name, pa.total_uses, pa.last_used
            FROM permission_analytics pa
            JOIN permissions p ON p.id = pa.permission_id
            ORDER BY pa.total_uses DESC
            LIMIT ?
        `,
            [limit]
        );
        return permissions;
    }

    async flushAnalytics(): Promise<void> {
        try {
            for (const [key, usage] of this.analyticsCache.roleUsage.entries()) {
                const roleId = parseInt(key.split(':')[1], 10);
                await db.query(
                    `
                    INSERT INTO role_analytics (role_id, total_users, total_actions, last_used)
                    VALUES (?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                        total_users = total_users + ?,
                        total_actions = total_actions + ?,
                        last_used = NOW()
                `,
                    [
                        roleId,
                        usage.users.size,
                        usage.count,
                        usage.users.size,
                        usage.count
                    ]
                );
            }

            for (const [key, usage] of this.analyticsCache.permissionUsage.entries()) {
                const permissionId = parseInt(key.split(':')[1], 10);
                await db.query(
                    `
                    INSERT INTO permission_analytics (permission_id, total_uses, last_used)
                    VALUES (?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                        total_uses = total_uses + ?,
                        last_used = NOW()
                `,
                    [
                        permissionId,
                        usage.count,
                        usage.count
                    ]
                );
            }

            this.analyticsCache.roleUsage.clear();
            this.analyticsCache.permissionUsage.clear();
            LogManager.info('Analytics flushed successfully');
        } catch (error: unknown) {
            LogManager.error('Failed to flush analytics', error);
        }
    }

    startPeriodicFlush(): void {
        setInterval((): void => {
            void this.flushAnalytics();
        }, this.flushInterval);
    }

    async generateAnalyticsReport(from: string | Date, to: string | Date): Promise<AnalyticsReport> {
        const [roleStats] = await db.query<[RoleUsageRow[]]>(
            `
            SELECT
                r.name as role_name,
                COUNT(DISTINCT ur.user_id) as active_users,
                ra.total_actions,
                ra.last_used
            FROM roles r
            LEFT JOIN user_roles ur ON r.id = ur.role_id
            LEFT JOIN role_analytics ra ON r.id = ra.role_id
            WHERE ra.last_used BETWEEN ? AND ?
            GROUP BY r.id
        `,
            [from as QueryValue, to as QueryValue]
        );

        const [permissionStats] = await db.query<[PermissionUsageRow[]]>(
            `
            SELECT
                p.name as permission_name,
                pa.total_uses,
                pa.last_used
            FROM permissions p
            LEFT JOIN permission_analytics pa ON p.id = pa.permission_id
            WHERE pa.last_used BETWEEN ? AND ?
        `,
            [from as QueryValue, to as QueryValue]
        );

        const [auditStats] = await db.query<[AuditActivityRow[]]>(
            `
            SELECT
                action_type,
                COUNT(*) as count,
                COUNT(DISTINCT admin_id) as unique_admins
            FROM auth_audit_log
            WHERE created_at BETWEEN ? AND ?
            GROUP BY action_type
        `,
            [from as QueryValue, to as QueryValue]
        );

        return {
            timeframe: { from, to },
            roles: roleStats,
            permissions: permissionStats,
            auditActivity: auditStats,
            generatedAt: new Date()
        };
    }
}

const authAnalytics = new AuthAnalytics();

module.exports = authAnalytics;
module.exports.AuthAnalytics = authAnalytics;
