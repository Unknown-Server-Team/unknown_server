const ValidationManager = require('./ValidationManager');
const LogManager = require('./LogManager');

class ValidationMiddleware {
    static validate(schema) {
        return (req, res, next) => {
            const { isValid, errors } = ValidationManager.validate(schema, req.body);
            if (!isValid) {
                LogManager.debug('Validation failed', { errors, path: req.path });
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors
                });
            }
            next();
        };
    }

    static validateRegistration(req, res, next) {
        const validation = ValidationManager.validateRegistration(req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.errors
            });
        }
        next();
    }

    static validateLogin(req, res, next) {
        const errors = {};
        
        if (!req.body.email || !ValidationManager.validateEmail(req.body.email)) {
            errors.email = ['Invalid email address'];
        }
        
        if (!req.body.password || req.body.password.length < 1) {
            errors.password = ['Password is required'];
        }

        if (Object.keys(errors).length > 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors
            });
        }
        next();
    }

    static sanitize() {
        return (req, res, next) => {
            if (req.body) {
                req.sanitizedBody = ValidationManager.sanitizeInput(req.body);
            }
            next();
        };
    }

    static validateId(paramName = 'id') {
        return (req, res, next) => {
            const id = parseInt(req.params[paramName]);
            if (isNaN(id) || id <= 0) {
                return res.status(400).json({
                    error: 'Invalid ID format',
                    details: { [paramName]: ['Must be a positive integer'] }
                });
            }
            req.params[paramName] = id;
            next();
        };
    }

    static validateQuery(rules) {
        return (req, res, next) => {
            const errors = {};
            Object.entries(rules).forEach(([key, rule]) => {
                if (rule.required && !req.query[key]) {
                    errors[key] = [`${key} is required`];
                } else if (req.query[key]) {
                    switch (rule.type) {
                        case 'number':
                            const num = Number(req.query[key]);
                            if (isNaN(num)) {
                                errors[key] = [`${key} must be a number`];
                            } else if (rule.min !== undefined && num < rule.min) {
                                errors[key] = [`${key} must be at least ${rule.min}`];
                            } else if (rule.max !== undefined && num > rule.max) {
                                errors[key] = [`${key} must be at most ${rule.max}`];
                            }
                            break;
                        case 'string':
                            if (rule.enum && !rule.enum.includes(req.query[key])) {
                                errors[key] = [`${key} must be one of: ${rule.enum.join(', ')}`];
                            }
                            break;
                        case 'boolean':
                            if (!/^(true|false)$/i.test(req.query[key])) {
                                errors[key] = [`${key} must be true or false`];
                            }
                            break;
                    }
                }
            });

            if (Object.keys(errors).length > 0) {
                return res.status(400).json({
                    error: 'Invalid query parameters',
                    details: errors
                });
            }
            next();
        };
    }

    static validateFile(options = {}) {
        return (req, res, next) => {
            if (!req.files || Object.keys(req.files).length === 0) {
                return res.status(400).json({
                    error: 'No files were uploaded',
                    details: { file: ['File is required'] }
                });
            }

            const file = req.files.file;
            const errors = [];

            if (options.maxSize && file.size > options.maxSize) {
                errors.push(`File size must be less than ${options.maxSize / (1024 * 1024)}MB`);
            }

            if (options.allowedTypes && !options.allowedTypes.includes(file.mimetype)) {
                errors.push(`File type must be one of: ${options.allowedTypes.join(', ')}`);
            }

            if (errors.length > 0) {
                return res.status(400).json({
                    error: 'Invalid file',
                    details: { file: errors }
                });
            }

            next();
        };
    }
}

module.exports = ValidationMiddleware;