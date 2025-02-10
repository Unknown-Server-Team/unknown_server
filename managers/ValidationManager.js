class ValidationManager {
    static validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    static validatePassword(password) {
        const requirements = {
            minLength: 8,
            hasUppercase: /[A-Z]/.test(password),
            hasLowercase: /[a-z]/.test(password),
            hasNumber: /\d/.test(password),
            hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password)
        };

        const errors = [];
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

    static validateName(name) {
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

    static validateRegistration(data) {
        const errors = {};

        // Validate email
        if (!data.email || !this.validateEmail(data.email)) {
            errors.email = ['Invalid email address'];
        }

        // Validate password
        const passwordValidation = this.validatePassword(data.password);
        if (!passwordValidation.isValid) {
            errors.password = passwordValidation.errors;
        }

        // Validate name
        const nameValidation = this.validateName(data.name);
        if (!nameValidation.isValid) {
            errors.name = nameValidation.errors;
        }

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }

    static sanitizeUser(user) {
        if (!user) return null;
        
        const { password, password_reset_token, email_verification_token, ...safeUser } = user;
        return safeUser;
    }

    static validate(schema, data) {
        const errors = {};
        
        Object.entries(schema).forEach(([field, rules]) => {
            if (rules.required && !data[field]) {
                errors[field] = [`${field} is required`];
                return;
            }

            if (data[field]) {
                if (rules.type === 'email' && !this.validateEmail(data[field])) {
                    errors[field] = ['Invalid email format'];
                }
                if (rules.type === 'password') {
                    const passwordValidation = this.validatePassword(data[field]);
                    if (!passwordValidation.isValid) {
                        errors[field] = passwordValidation.errors;
                    }
                }
                if (rules.minLength && data[field].length < rules.minLength) {
                    errors[field] = [`Must be at least ${rules.minLength} characters`];
                }
                if (rules.maxLength && data[field].length > rules.maxLength) {
                    errors[field] = [`Must be no more than ${rules.maxLength} characters`];
                }
                if (rules.pattern && !rules.pattern.test(data[field])) {
                    errors[field] = [rules.message || 'Invalid format'];
                }
            }
        });

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }

    static sanitizeInput(data) {
        if (!data) return data;
        
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string') {
                // Remove any HTML tags and trim
                sanitized[key] = value.replace(/<[^>]*>/g, '').trim();
            } else if (Array.isArray(value)) {
                // Recursively sanitize arrays
                sanitized[key] = value.map(item => 
                    typeof item === 'object' ? this.sanitizeInput(item) : item
                );
            } else if (typeof value === 'object' && value !== null) {
                // Recursively sanitize nested objects
                sanitized[key] = this.sanitizeInput(value);
            } else {
                // Keep other types as is
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
}

module.exports = ValidationManager;