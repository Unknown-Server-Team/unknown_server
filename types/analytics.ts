import type { QueryValue } from './modules';

export type { QueryValue };

export interface UsageCacheEntry {
    count: number;
    users: Set<number>;
}

export interface AnalyticsCache {
    roleUsage: Map<string, UsageCacheEntry>;
    permissionUsage: Map<string, UsageCacheEntry>;
    userActivity: Map<string, unknown>;
}

export interface AuditEventData {
    action_type: string;
    admin_id: number;
    target_id: number;
    role_id?: number | null;
    permission_id?: number | null;
    metadata?: Record<string, unknown>;
    ip_address?: string | null;
}

export interface AuditFilters {
    action_type?: string;
    admin_id?: number;
    target_id?: number;
    dateFrom?: string | Date;
    dateTo?: string | Date;
}

export interface PaginationOptions {
    page: number;
    limit: number;
}

export interface AuditLogPagination extends PaginationOptions {
    total: number;
    pages: number;
}

export interface AuditLogResult<RowType> {
    data: RowType[];
    pagination: AuditLogPagination;
}

export interface RoleAnalyticsRow {
    [key: string]: unknown;
}

export interface PermissionAnalyticsRow {
    [key: string]: unknown;
}

export interface RoleUsageRow {
    name: string;
    total_users: number;
    total_actions: number;
    last_used: Date | string | null;
}

export interface PermissionUsageRow {
    name: string;
    total_uses: number;
    last_used: Date | string | null;
}

export interface AuditActivityRow {
    action_type: string;
    count: number;
    unique_admins: number;
}

export interface AnalyticsReport {
    timeframe: {
        from: string | Date;
        to: string | Date;
    };
    roles: RoleUsageRow[];
    permissions: PermissionUsageRow[];
    auditActivity: AuditActivityRow[];
    generatedAt: Date;
}
