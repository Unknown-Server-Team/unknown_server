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