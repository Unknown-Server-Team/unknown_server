export interface LogManagerModule {
    info(message: string, meta?: unknown): void;
    warning(message: string, meta?: unknown): void;
    error(message: string, error?: unknown): void;
    success(message: string, meta?: unknown): void;
    debug(message: string, meta?: unknown): void;
}

export interface CacheManagerModule {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, ttl?: number): Promise<boolean>;
    del(key: string): Promise<boolean>;
    keys(pattern?: string): string[];
}

export type QueryValue = string | number | Date | boolean | null | QueryValue[];

export interface DatabaseModule {
    query<T = unknown>(sql: string, params?: QueryValue[]): Promise<T>;
}

export interface VersionManagerModule {
    getSupportedVersions(): string[];
    isDeprecated(version: string): boolean;
}

export interface RoleManagerModule {
    getUserRoles(userId: number): Promise<unknown>;
    hasAnyRole(userId: number, roles: string[]): Promise<boolean>;
    getDefaultRole(): Promise<{ id: number } | null>;
    assignRole(userId: number, roleId: number): Promise<void>;
    createRoleMiddleware(roles: string[]): (...args: unknown[]) => unknown;
}

export interface EmailManagerModule {
    sendVerificationEmail(user: { id: number; email: string; name?: string | null }, token: string): Promise<unknown>;
    sendPasswordResetEmail(user: { id: number; email: string; name?: string | null }, token: string): Promise<unknown>;
}

export interface PermissionManagerModule {
    assignPermissionToRole(roleId: number, permissionId: number): Promise<void>;
    getRolePermissions(roleId: number): Promise<unknown[]>;
    checkPermissions(userId: number, requiredPermissions: string[], requireAll?: boolean): Promise<boolean>;
}

export interface AuthAnalyticsModule {
    trackRoleUsage?(roleId: number, userId: number): Promise<void>;
    logAuditEvent?(event: unknown): Promise<void>;
}

export interface AuthMonitorModule {
    trackLoginAttempt(success: boolean, ip?: string): void;
    getMetrics(): unknown;
}

export interface WebsocketManagerModule {
    notifySecurityEvent(eventType: string, data: unknown): void;
}
