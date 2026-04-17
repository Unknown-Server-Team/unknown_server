import type {
    ValidationResult,
    RegistrationValidationResult,
    ValidationRule,
    ValidationSchema,
    GenericValidationResult,
    RegistrationData,
    UserData,
    SanitizedValue,
    SanitizedObject
} from '../types/validation';

type ValidatableData = Record<string, unknown>;

class ValidationManager {
    static validateEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    static validatePassword(password: string): ValidationResult {
        const requirements = {
            minLength: 8,
            hasUppercase: /[A-Z]/.test(password),
            hasLowercase: /[a-z]/.test(password),
            hasNumber: /\d/.test(password),
            hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password)
        };

        const errors: string[] = [];
        if (password.length < requirements.minLength) {
            errors.push(`Password must be at least ${requirements.minLength} characters long`);
        }
        if (!requirements.hasUppercase) {
            errors.push('Password must contain at least one uppercase letter');
        }
        if (!requirements.hasLowercase) {
            errors.push('Password must contain at least one lowercase letter');
        }
        if (!requirements.hasNumber) {
            errors.push('Password must contain at least one number');
        }
        if (!requirements.hasSpecialChar) {
            errors.push('Password must contain at least one special character');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static validateName(name: string): ValidationResult {
        if (typeof name !== 'string' || name.trim().length < 2) {
            return {
                isValid: false,
                errors: ['Name must be at least 2 characters long']
            };
        }
        return {
            isValid: true,
            errors: []
        };
    }

    static validateRegistration(data: RegistrationData): RegistrationValidationResult {
        const errors: Record<string, string[]> = {};

        if (!data.email || !this.validateEmail(data.email)) {
            errors.email = ['Invalid email address'];
        }

        const passwordValidation = this.validatePassword(data.password);
        if (!passwordValidation.isValid) {
            errors.password = passwordValidation.errors;
        }

        const nameValidation = this.validateName(data.name);
        if (!nameValidation.isValid) {
            errors.name = nameValidation.errors;
        }

        if (data.roles !== undefined) {
            if (!Array.isArray(data.roles)) {
                errors.roles = ['Roles must be an array'];
            } else {
                const invalidRoles = data.roles.filter((role: unknown) => typeof role !== 'string' || !role.trim());
                if (invalidRoles.length > 0) {
                    errors.roles = ['All roles must be non-empty strings'];
                }
            }
        }

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }

    static sanitizeUser(user: UserData | null): Omit<UserData, 'password' | 'password_reset_token' | 'email_verification_token'> | null {
        if (!user) {
            return null;
        }

        const { password, password_reset_token, email_verification_token, ...safeUser } = user;
        return safeUser;
    }

    static validate(schema: ValidationSchema, data: ValidatableData): GenericValidationResult {
        const errors: Record<string, string[]> = {};

        Object.entries(schema).forEach(([field, rules]: [string, ValidationRule]) => {
            const value = data[field];

            if (rules.required && !value) {
                errors[field] = [`${field} is required`];
                return;
            }

            if (value) {
                if (rules.type === 'email' && typeof value === 'string' && !this.validateEmail(value)) {
                    errors[field] = ['Invalid email format'];
                }
                if (rules.type === 'password' && typeof value === 'string') {
                    const passwordValidation = this.validatePassword(value);
                    if (!passwordValidation.isValid) {
                        errors[field] = passwordValidation.errors;
                    }
                }
                if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
                    errors[field] = [`Must be at least ${rules.minLength} characters`];
                }
                if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
                    errors[field] = [`Must be no more than ${rules.maxLength} characters`];
                }
                if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
                    errors[field] = [rules.message || 'Invalid format'];
                }
            }
        });

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }

    static sanitizeInput<T extends SanitizedValue>(data: T): T {
        if (!data) {
            return data;
        }

        if (typeof data === 'string') {
            return data.replace(/<[^>]*>/g, '').trim() as T;
        }

        if (Array.isArray(data)) {
            return data.map((item) => (typeof item === 'object' ? this.sanitizeInput(item as SanitizedValue) : item)) as T;
        }

        if (typeof data === 'object') {
            const sanitized: SanitizedObject = {};
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    sanitized[key] = value.replace(/<[^>]*>/g, '').trim();
                } else if (Array.isArray(value)) {
                    sanitized[key] = value.map((item) => (typeof item === 'object' ? this.sanitizeInput(item as SanitizedValue) : item)) as SanitizedValue[];
                } else if (typeof value === 'object' && value !== null) {
                    sanitized[key] = this.sanitizeInput(value as SanitizedValue);
                } else {
                    sanitized[key] = value as SanitizedValue;
                }
            }
            return sanitized as T;
        }

        return data;
    }
}

export = ValidationManager;
