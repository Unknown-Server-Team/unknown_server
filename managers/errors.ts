export class AuthError extends Error {
    public code: string;

    constructor(message: string, code: string = 'AUTH_ERROR') {
        super(message);
        this.name = 'AuthError';
        this.code = code;
    }
}

export class ValidationError extends Error {
    public details: Record<string, any>;

    constructor(message: string, details: Record<string, any> = {}) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

export class PermissionError extends Error {
    public requiredPermissions: string[];

    constructor(message: string, requiredPermissions: string[] = []) {
        super(message);
        this.name = 'PermissionError';
        this.requiredPermissions = requiredPermissions;
    }
}

export class RoleError extends Error {
    public roleDetails: Record<string, any>;

    constructor(message: string, roleDetails: Record<string, any> = {}) {
        super(message);
        this.name = 'RoleError';
        this.roleDetails = roleDetails;
    }
}

// For backward compatibility with CommonJS
module.exports = {
    AuthError,
    ValidationError,
    PermissionError,
    RoleError
};