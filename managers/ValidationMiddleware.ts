import { ValidationManager } from './ValidationManager';
import { VersionManager } from './VersionManager';
import { LogManager } from './LogManager';
import { Request, Response, NextFunction } from 'express';

interface ValidationRule {
    required?: boolean;
    type: 'number' | 'string' | 'boolean';
    min?: number;
    max?: number;
    enum?: string[];
}

interface ValidationRules {
    [key: string]: ValidationRule;
}

interface FileValidationOptions {
    maxSize?: number;
    allowedTypes?: string[];
}

interface ExtendedRequest extends Request {
    sanitizedBody?: any;
    apiVersion?: string;
    files?: any;
}

export class ValidationMiddleware {
    static validate(schema: any) {
        return (req: ExtendedRequest, res: Response, next: NextFunction) => {
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

    static validateRegistration(req: ExtendedRequest, res: Response, next: NextFunction) {
        const validation = ValidationManager.validateRegistration(req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.errors
            });
        }
        next();
    }

    static validateLogin(req: ExtendedRequest, res: Response, next: NextFunction) {
        const errors: Record<string, string[]> = {};
        
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
        return (req: ExtendedRequest, res: Response, next: NextFunction) => {
            if (req.body) {
                req.sanitizedBody = ValidationManager.sanitizeInput(req.body);
            }
            next();
        };
    }

    static validateId(paramName: string = 'id') {
        return (req: ExtendedRequest, res: Response, next: NextFunction) => {
            const id = parseInt(req.params[paramName]);
            if (isNaN(id) || id <= 0) {
                return res.status(400).json({
                    error: 'Invalid ID format',
                    details: { [paramName]: ['Must be a positive integer'] }
                });
            }
            req.params[paramName] = id.toString();
            next();
        };
    }

    static validateQuery(rules: ValidationRules) {
        return (req: ExtendedRequest, res: Response, next: NextFunction) => {
            const errors: Record<string, string[]> = {};
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
                            if (rule.enum && !rule.enum.includes(req.query[key] as string)) {
                                errors[key] = [`${key} must be one of: ${rule.enum.join(', ')}`];
                            }
                            break;
                        case 'boolean':
                            if (!/^(true|false)$/i.test(req.query[key] as string)) {
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

    static validateFile(options: FileValidationOptions = {}) {
        return (req: ExtendedRequest, res: Response, next: NextFunction) => {
            if (!req.files || Object.keys(req.files).length === 0) {
                return res.status(400).json({
                    error: 'No files were uploaded',
                    details: { file: ['File is required'] }
                });
            }

            const file = req.files.file;
            const errors: string[] = [];

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

    static validateApiVersion() {
        return (req: ExtendedRequest, res: Response, next: NextFunction) => {
            const version = req.headers['accept-version'] as string;
            const supportedVersions = VersionManager.getSupportedVersions();

            // If no version specified, use latest non-deprecated version
            if (!version) {
                const latestVersion = supportedVersions
                    .filter(v => !VersionManager.isDeprecated(v))
                    .sort()
                    .pop();
                req.apiVersion = latestVersion;
                return next();
            }

            // Check if version exists
            if (!supportedVersions.includes(version)) {
                return res.status(400).json({
                    error: 'Unsupported API version',
                    message: `Version ${version} is not supported`,
                    supportedVersions,
                    latest: supportedVersions[supportedVersions.length - 1]
                });
            }

            // Warning for deprecated versions
            if (VersionManager.isDeprecated(version)) {
                res.set('Warning', '299 - "This API version is deprecated"');
                LogManager.warning(`Deprecated API version ${version} accessed`, {
                    path: req.path,
                    ip: req.ip
                });
            }

            req.apiVersion = version;
            next();
        };
    }
}

export default ValidationMiddleware;