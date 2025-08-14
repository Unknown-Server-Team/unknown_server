import { LogManager } from './LogManager';
import { db } from '../database/db';
import { CacheManager } from './CacheManager';
import { 
    AuditEventData, 
    AuditLogFilters, 
    PaginationParams, 
    PaginatedResponse,
    RoleAnalyticsData,
    PermissionAnalyticsData,
    AnalyticsReport
} from '../types';

interface UsageData {
    count: number;
    users: Set<number>;
}

interface AnalyticsCache {
    roleUsage: Map<string, UsageData>;
    permissionUsage: Map<string, UsageData>;
    userActivity: Map<string, any>;
}

class AuthAnalytics {
    private analyticsCache: AnalyticsCache;
    private flushInterval: number;

    constructor() {
        this.analyticsCache = {
            roleUsage: new Map(),
            permissionUsage: new Map(),
            userActivity: new Map()
        };
        
        this.flushInterval = 5 * 60 * 1000; // 5 minutes
        this.startPeriodicFlush();
    }

    async trackRoleUsage(roleId: number, userId: number): Promise<void> {
        const key = `role:${roleId}`;
        const usage = this.analyticsCache.roleUsage.get(key) || { count: 0, users: new Set() };
        usage.count++;
        usage.users.add(userId);
        this.analyticsCache.roleUsage.set(key, usage);
    }

    async trackPermissionUse(permissionId: number, userId: number): Promise<void> {
        const key = `permission:${permissionId}`;
        const usage = this.analyticsCache.permissionUsage.get(key) || { count: 0, users: new Set() };
        usage.count++;
        usage.users.add(userId);
        this.analyticsCache.permissionUsage.set(key, usage);
    }

    async logAuditEvent(data: AuditEventData): Promise<void> {
        try {
            await db.query(`
                INSERT INTO auth_audit_log 
                (action_type, admin_id, target_id, role_id, permission_id, metadata, ip_address)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                data.action_type,
                data.admin_id,
                data.target_id,
                data.role_id,
                data.permission_id,
                JSON.stringify(data.metadata || {}),
                data.ip_address
            ]);
        } catch (error) {
            LogManager.error('Failed to log audit event', error);
        }
    }

    async getAuditLog(
        filters: AuditLogFilters = {}, 
        pagination: PaginationParams = { page: 1, limit: 20 }
    ): Promise<PaginatedResponse<any>> {
        const conditions: string[] = [];
        const params: any[] = [];

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
            params.push(filters.dateFrom);
        }

        if (filters.dateTo) {
            conditions.push('created_at <= ?');
            params.push(filters.dateTo);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const offset = (pagination.page - 1) * pagination.limit;

        const [rows] = await db.query(`
            SELECT * FROM auth_audit_log
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, pagination.limit, offset]);

        const [[{ total }]] = await db.query(`
            SELECT COUNT(*) as total FROM auth_audit_log ${whereClause}
        `, params);

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

    async getRoleAnalytics(roleId: number | null = null): Promise<RoleAnalyticsData[]> {
        const cacheKey = `analytics:role:${roleId || 'all'}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        const query = roleId 
            ? 'SELECT * FROM role_analytics WHERE role_id = ?'
            : 'SELECT * FROM role_analytics';
        
        const [data] = await db.query(query, roleId ? [roleId] : []);
        await CacheManager.set(cacheKey, data, 300); // Cache for 5 minutes
        return data;
    }

    async getPermissionAnalytics(permissionId: number | null = null): Promise<PermissionAnalyticsData[]> {
        const cacheKey = `analytics:permission:${permissionId || 'all'}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;

        const query = permissionId 
            ? 'SELECT * FROM permission_analytics WHERE permission_id = ?'
            : 'SELECT * FROM permission_analytics';
        
        const [data] = await db.query(query, permissionId ? [permissionId] : []);
        await CacheManager.set(cacheKey, data, 300);
        return data;
    }

    async getMostUsedRoles(limit: number = 10): Promise<any[]> {
        const [roles] = await db.query(`
            SELECT r.name, ra.total_users, ra.total_actions, ra.last_used
            FROM role_analytics ra
            JOIN roles r ON r.id = ra.role_id
            ORDER BY ra.total_actions DESC
            LIMIT ?
        `, [limit]);
        return roles;
    }

    async getMostUsedPermissions(limit: number = 10): Promise<any[]> {
        const [permissions] = await db.query(`
            SELECT p.name, pa.total_uses, pa.last_used
            FROM permission_analytics pa
            JOIN permissions p ON p.id = pa.permission_id
            ORDER BY pa.total_uses DESC
            LIMIT ?
        `, [limit]);
        return permissions;
    }

    async flushAnalytics(): Promise<void> {
        try {
            // Flush role usage
            for (const [key, usage] of this.analyticsCache.roleUsage) {
                const roleId = parseInt(key.split(':')[1]);
                await db.query(`
                    INSERT INTO role_analytics (role_id, total_users, total_actions, last_used)
                    VALUES (?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE 
                        total_users = total_users + ?,
                        total_actions = total_actions + ?,
                        last_used = NOW()
                `, [
                    roleId,
                    usage.users.size,
                    usage.count,
                    usage.users.size,
                    usage.count
                ]);
            }

            // Flush permission usage
            for (const [key, usage] of this.analyticsCache.permissionUsage) {
                const permissionId = parseInt(key.split(':')[1]);
                await db.query(`
                    INSERT INTO permission_analytics (permission_id, total_uses, last_used)
                    VALUES (?, ?, NOW())
                    ON DUPLICATE KEY UPDATE 
                        total_uses = total_uses + ?,
                        last_used = NOW()
                `, [
                    permissionId,
                    usage.count,
                    usage.count
                ]);
            }

            // Clear caches
            this.analyticsCache.roleUsage.clear();
            this.analyticsCache.permissionUsage.clear();

            LogManager.info('Analytics flushed successfully');
        } catch (error) {
            LogManager.error('Failed to flush analytics', error);
        }
    }

    private startPeriodicFlush(): void {
        setInterval(() => this.flushAnalytics(), this.flushInterval);
    }

    async generateAnalyticsReport(from: string, to: string): Promise<AnalyticsReport> {
        const [roleStats] = await db.query(`
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
        `, [from, to]);

        const [permissionStats] = await db.query(`
            SELECT 
                p.name as permission_name,
                pa.total_uses,
                pa.last_used
            FROM permissions p
            LEFT JOIN permission_analytics pa ON p.id = pa.permission_id
            WHERE pa.last_used BETWEEN ? AND ?
        `, [from, to]);

        const [auditStats] = await db.query(`
            SELECT 
                action_type,
                COUNT(*) as count,
                COUNT(DISTINCT admin_id) as unique_admins
            FROM auth_audit_log
            WHERE created_at BETWEEN ? AND ?
            GROUP BY action_type
        `, [from, to]);

        return {
            timeframe: { from, to },
            roles: roleStats,
            permissions: permissionStats,
            auditActivity: auditStats,
            generatedAt: new Date()
        };
    }
}

export const authAnalytics = new AuthAnalytics();
export default authAnalytics;