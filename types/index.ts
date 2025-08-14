// Shared TypeScript types for the Unknown Server project

import { Request, Response, NextFunction } from 'express';

// Extend Express Request interface globally
declare global {
    namespace Express {
        interface Request {
            user?: UserData;
            apiVersion?: string;
        }
    }
}

// Auth related types
export interface UserData {
    id: number;
    name: string;
    email: string;
    created_at?: Date;
    updated_at?: Date;
    email_verified?: boolean;
    [key: string]: any;
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

// API Response types
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    errors?: string[] | Record<string, string[]>;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

// Validation types
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

// Middleware types
export type MiddlewareFunction = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

// Log types
export interface LogMetadata {
    [key: string]: any;
}

// Version Management types
export interface ApiVersion {
    version: string;
    deprecated: boolean;
    deprecationDate?: Date;
}

// Database types
export interface DatabaseConnection {
    query(sql: string, params?: any[]): Promise<any>;
    escape(value: any): string;
}

// Database query result types
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

// Query interfaces
export interface UserQueries {
    createUser(userData: RegistrationData): Promise<any>;
    getUserByEmail(email: string): Promise<UserRecord | undefined>;
    getUserById(id: number): Promise<UserRecord | undefined>;
    getUserByEmailVerificationToken(token: string): Promise<UserRecord | undefined>;
    getUserByPasswordResetToken(token: string): Promise<UserRecord | undefined>;
    setEmailVerificationToken(userId: number, token: string, expires: Date): Promise<any>;
    setPasswordResetToken(userId: number, token: string, expires: Date): Promise<any>;
    verifyEmail(userId: number): Promise<any>;
    updatePassword(userId: number, password: string): Promise<any>;
    getUsers(offset?: number, limit?: number): Promise<UserRecord[]>;
    getUserCount(): Promise<number>;
    countUsersByRole(roleName: string): Promise<number>;
    deleteUser(userId: number): Promise<boolean>;
}

export interface RoleHierarchyQueries {
    getChildRoles(roleId: number): Promise<RoleRecord[]>;
    getParentRoles(roleId: number): Promise<RoleRecord[]>;
    addChildRole(parentRoleId: number, childRoleId: number): Promise<any>;
    removeChildRole(parentRoleId: number, childRoleId: number): Promise<any>;
    wouldCreateCircularReference(parentRoleId: number, childRoleId: number): Promise<boolean>;
}

export interface DatabaseQueries {
    initializeQueries(): Promise<void>;
    userQueries: UserQueries;
    roleHierarchyQueries: RoleHierarchyQueries;
}

// Worker Thread types
export interface WorkerTask {
    operation: string;
    data: any;
    options?: any;
}

export interface WorkerResult {
    success: boolean;
    result?: any;
    error?: string;
}

// Server Configuration types
export interface ServerConfig {
    port: number;
    maxWorkerThreads?: number;
    isClusterWorker: boolean;
    workerId?: number;
}

export interface ServiceConfig {
    endpoints: Array<{
        path: string;
        handler: any;
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
    middleware?: Array<(req: any) => void>;
}

// Environment Variables type
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