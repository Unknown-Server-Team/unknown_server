import { Request, Response, NextFunction } from 'express';

declare global {
    namespace Express {
        interface Request {
            user?: UserData;
            apiVersion?: string;
        }
    }
}

export interface UserData {
    id: number;
    name: string;
    email: string;
    created_at?: Date;
    updated_at?: Date;
    email_verified?: boolean;
    roles?: RoleRecord[];
    permissions?: PermissionRecord[];
    [key: string]: unknown;
}

export interface LoginData {
    email: string;
    password: string;
}

export interface RegistrationData {
    name: string;
    email: string;
    password: string;
    roles?: string[];
}

export interface AuthResponse {
    token: string;
    user: UserData;
    expiresIn?: number;
}

export interface LoginResponse extends AuthResponse {}

export interface RegistrationResponse extends AuthResponse {}

export interface RoleData {
    id: number;
    name: string;
    description?: string;
    permissions?: PermissionData[];
}

export interface PermissionData {
    id: number;
    name: string;
    resource: string;
    action: string;
    description?: string;
}

export interface AuthResult {
    success: boolean;
    message?: string;
    user?: UserData;
    token?: string;
}

export interface TokenVerificationResult {
    success: boolean;
    user?: UserData;
    expired?: boolean;
}

export interface EncryptionSettings {
    saltLength: number;
    keyAlgorithm: string;
    iterations: number;
    keyLength: number;
}

export interface AuthenticatedRequest extends Omit<Request, 'user'> {
    user?: UserData;
    apiVersion?: string;
    isCliRequest?: boolean;
}

export interface CliRequest extends AuthenticatedRequest {
    isCliRequest: boolean;
}

export interface RateLimiterConfig {
    windowMs: number;
    max: number;
    message: string;
    burstMultiplier?: number;
    onLimitReached?: (req: Request) => void;
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    message?: string;
    errors?: string[] | Record<string, string[]>;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface ValidationSchema {
    [field: string]: {
        required?: boolean;
        type?: 'email' | 'password' | 'string' | 'number' | 'boolean';
        minLength?: number;
        maxLength?: number;
        pattern?: RegExp;
        message?: string;
    };
}

export type MiddlewareFunction = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

export interface LogMetadata {
    [key: string]: unknown;
}

export interface LogInfo extends LogMetadata {
    level: string;
    message: string;
    timestamp: string;
    metadata: LogMetadata;
}

export interface ApiVersion {
    version: string;
    deprecated: boolean;
    deprecationDate?: Date;
}

export interface DatabaseConnection {
    query(sql: string, params?: unknown[]): Promise<unknown>;
    escape(value: unknown): string;
}

export interface UserRecord {
    id: number;
    email: string;
    password?: string;
    name: string;
    email_verified: boolean;
    email_verification_token?: string;
    email_verification_expires?: Date;
    password_reset_token?: string;
    password_reset_expires?: Date;
    created_at: Date;
    updated_at: Date;
}

export interface RoleRecord {
    id: number;
    name: string;
    description?: string;
    created_at: Date;
    updated_at: Date;
}

export interface PermissionRecord {
    id: number;
    name: string;
    resource: string;
    action: string;
    description?: string;
    created_at: Date;
    updated_at: Date;
}

export interface SessionRecord {
    id: string;
    user_id: number;
    data: string;
    expires: Date;
    created_at: Date;
    updated_at: Date;
}

export interface UserQueries {
    createUser(userData: RegistrationData): Promise<unknown>;
    getUserByEmail(email: string): Promise<UserRecord | undefined>;
    getUserById(id: number): Promise<UserRecord | undefined>;
    getUserByEmailVerificationToken(token: string): Promise<UserRecord | undefined>;
    getUserByPasswordResetToken(token: string): Promise<UserRecord | undefined>;
    setEmailVerificationToken(userId: number, token: string, expires: Date): Promise<unknown>;
    setPasswordResetToken(userId: number, token: string, expires: Date): Promise<unknown>;
    verifyEmail(userId: number): Promise<unknown>;
    updatePassword(userId: number, password: string): Promise<unknown>;
    getUsers(offset?: number, limit?: number): Promise<UserRecord[]>;
    getUserCount(): Promise<number>;
    countUsersByRole(roleName: string): Promise<number>;
    deleteUser(userId: number): Promise<boolean>;
}

export interface RoleHierarchyQueries {
    getChildRoles(roleId: number): Promise<RoleRecord[]>;
    getParentRoles(roleId: number): Promise<RoleRecord[]>;
    addChildRole(parentRoleId: number, childRoleId: number): Promise<unknown>;
    removeChildRole(parentRoleId: number, childRoleId: number): Promise<unknown>;
    wouldCreateCircularReference(parentRoleId: number, childRoleId: number): Promise<boolean>;
}

export interface DatabaseQueries {
    initializeQueries(): Promise<void>;
    userQueries: UserQueries;
    roleHierarchyQueries: RoleHierarchyQueries;
}

export interface WorkerTask {
    operation: string;
    data: unknown;
    options?: unknown;
}

export interface WorkerResult {
    success: boolean;
    result?: unknown;
    error?: string;
}

export interface ServerConfig {
    port: number;
    maxWorkerThreads?: number;
    isClusterWorker: boolean;
    workerId?: number;
}

export interface ServiceConfig {
    endpoints: Array<{
        path: string;
        handler: unknown;
    }>;
    healthCheck?: () => Promise<boolean>;
    circuitBreaker?: {
        timeout: number;
        errorThresholdPercentage: number;
        resetTimeout: number;
    };
    cacheTTL?: number;
    maxRetries?: number;
}

export interface ServiceMeshConfig {
    name: string;
    url: string;
    version: string;
}

export interface ServiceProxyConfig {
    target: string;
    routes: string[];
    loadBalancingStrategy?: 'round-robin' | 'least-connections' | 'random';
    middleware?: Array<(req: unknown) => void>;
}

export interface AuditEventData {
    action_type: string;
    admin_id?: number;
    target_id?: number;
    role_id?: number;
    permission_id?: number;
    metadata?: unknown;
    ip_address?: string;
}

export interface AuditLogFilters {
    action_type?: string;
    admin_id?: number;
    target_id?: number;
    dateFrom?: string;
    dateTo?: string;
}

export interface RoleAnalyticsData {
    id: number;
    role_id: number;
    total_users: number;
    total_actions: number;
    last_used: Date;
}

export interface PermissionAnalyticsData {
    id: number;
    permission_id: number;
    total_uses: number;
    last_used: Date;
}

export interface AnalyticsReport {
    timeframe: {
        from: string;
        to: string;
    };
    roles: unknown[];
    permissions: unknown[];
    auditActivity: unknown[];
    generatedAt: Date;
}

export interface EnvironmentConfig {
    DB_HOST: string;
    DB_USER: string;
    DB_NAME: string;
    VERSION: string;
    JWT_SECRET: string;
    APP_URL: string;
    PORT?: string;
    NODE_ENV?: string;
    AUTH_SERVICE_URL?: string;
    MAX_WORKER_THREADS?: string;
    SERVER_WORKERS?: string;
    pm_id?: string;
    NODE_APP_INSTANCE?: string;
}
