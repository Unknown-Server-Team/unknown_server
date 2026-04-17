import type { Request } from 'express';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface RegistrationValidationResult {
    isValid: boolean;
    errors: Record<string, string[]>;
}

export interface ValidationRule {
    required?: boolean;
    type?: 'email' | 'password' | 'string';
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    message?: string;
}

export interface ValidationSchema {
    [field: string]: ValidationRule;
}

export interface GenericValidationResult {
    isValid: boolean;
    errors: Record<string, string[]>;
}

export interface RegistrationData {
    email?: string;
    password: string;
    name: string;
    roles?: unknown;
}

export interface UserData {
    password?: unknown;
    password_reset_token?: unknown;
    email_verification_token?: unknown;
    [key: string]: unknown;
}

export type SanitizedValue = string | number | boolean | null | undefined | SanitizedObject | SanitizedValue[];

export interface SanitizedObject {
    [key: string]: SanitizedValue;
}

export interface QueryRule {
    required?: boolean;
    type?: 'number' | 'string' | 'boolean';
    min?: number;
    max?: number;
    enum?: string[];
}

export interface UploadedFile {
    size: number;
    mimetype: string;
}

export interface FileValidationOptions {
    maxSize?: number;
    allowedTypes?: string[];
}

export interface TypedRequest extends Omit<Request, 'params' | 'files' | 'body' | 'query' | 'user'> {
    body: Record<string, unknown>;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
    files?: {
        file: UploadedFile;
        [key: string]: UploadedFile;
    };
    sanitizedBody?: unknown;
    apiVersion?: string;
    user?: { id: number };
    permissions?: unknown;
}

export interface ErrorResponseBody {
    error: string;
    details?: Record<string, string[]>;
    message?: string;
    supportedVersions?: string[];
    latest?: string;
}

export interface ValidationManagerModule {
    validate(schema: ValidationSchema, data: Record<string, unknown>): GenericValidationResult;
    validateRegistration(data: Record<string, unknown>): GenericValidationResult;
    validateEmail(email: string): boolean;
    sanitizeInput<T>(data: T): T;
}
