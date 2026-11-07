import type { Request } from 'express';
import type { RoleRecord, UserRecord } from './index';

export interface VerificationEmailUser {
    id: number;
    email: string;
    name?: string | null;
    email_verified?: boolean;
    roles?: RoleRecord[];
}

export interface WorkerEncryptionPayload {
    text: string;
    key: string;
    iv?: string;
}

export interface WorkerTaskOptions {
    operation: 'encrypt' | 'decrypt';
}

export interface EncryptionResult {
    result: string;
    iv: string;
}

export interface WorkerThreadManagerModule {
    executeTask(taskType: string, data: WorkerEncryptionPayload, options?: WorkerTaskOptions): Promise<EncryptionResult>;
}

export interface AuthResult {
    success: boolean;
    message?: string;
    user?: UserRecord;
    token?: string;
}

export interface JwtPayload {
    id: number;
    email: string;
    roles: string[];
    iat?: number;
    exp?: number;
}

export interface AuthenticatedRequest extends Omit<Request, 'user'> {
    user?: VerificationEmailUser;
    userRoles?: unknown;
}

export interface AuthMiddlewareOptions {
    requireVerified: boolean;
    roles: string[];
}

export interface CreateUserInput {
    email: string;
    password: string;
    name: string;
    roles?: string[];
}
