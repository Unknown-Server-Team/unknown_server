import type { Request } from 'express';
import type { UserData } from './index';

export interface PermissionRecord {
    id: number;
    name: string;
    description?: string | null;
    [key: string]: unknown;
}

export interface UserRoleRow {
    user_id: number;
}

export interface CountRow {
    count: number;
}

export interface PermissionMiddlewareOptions {
    requireAll: boolean;
}

export interface PermissionRequest extends Omit<Request, 'user'> {
    user?: UserData;
    permissions?: PermissionRecord[];
}
