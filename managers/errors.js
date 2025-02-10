class AuthError extends Error {
    constructor(message, code = 'AUTH_ERROR') {
        super(message);
        this.name = 'AuthError';
        this.code = code;
    }
}

class ValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

class PermissionError extends Error {
    constructor(message, requiredPermissions = []) {
        super(message);
        this.name = 'PermissionError';
        this.requiredPermissions = requiredPermissions;
    }
}

class RoleError extends Error {
    constructor(message, roleDetails = {}) {
        super(message);
        this.name = 'RoleError';
        this.roleDetails = roleDetails;
    }
}

module.exports = {
    AuthError,
    ValidationError,
    PermissionError,
    RoleError
};