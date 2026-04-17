import type { Request } from 'express';

export interface VerificationEmailUser {
    id: number;
    email: string;
    name?: string | null;
    email_verified?: boolean;
    roles?: string[];
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

export interface UserQueriesModule {
    setVerificationToken(userId: number, token: string, expires: Date): Promise<unknown>;
    getUserByEmail(email: string): Promise<VerificationEmailUser | null>;
    setPasswordResetToken(userId: number, token: string, expires: Date): Promise<unknown>;
    getUserByResetToken(token: string): Promise<VerificationEmailUser | null>;
    updatePassword(userId: number, password: string): Promise<unknown>;
    verifyEmail(token: string): Promise<VerificationEmailUser | null>;
    getUserById(id: number): Promise<VerificationEmailUser | null>;
    createUser(userData: { email: string; password: string; name: string }): Promise<{ insertId?: number }>;
    deleteUser(userId: number): Promise<unknown>;
}

export interface EncryptionSettings {
    saltLength: number;
    keyAlgorithm: string;
    iterations: number;
    keyLength: number;
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
