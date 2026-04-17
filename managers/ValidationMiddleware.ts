import type { NextFunction, Response } from 'express';
import type {
    ValidationSchema,
    GenericValidationResult,
    TypedRequest,
    ErrorResponseBody,
    FileValidationOptions,
    UploadedFile,
    QueryRule
} from '../types/validation';
import type {
    VersionManagerModule,
    LogManagerModule
} from '../types/modules';
import type { ValidationManagerModule } from '../types/validation';

const ValidationManager = require('./ValidationManager') as ValidationManagerModule;
const VersionManager = require('./VersionManager') as VersionManagerModule;
const LogManager = require('./LogManager') as LogManagerModule;

class ValidationMiddleware {
    static validate(schema: ValidationSchema): (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction) => Response<ErrorResponseBody> | void {
        return (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void => {
            const { isValid, errors } = ValidationManager.validate(schema, req.body) as GenericValidationResult;
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

    static validateRegistration(req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void {
        const validation = ValidationManager.validateRegistration(req.body) as GenericValidationResult;
        if (!validation.isValid) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.errors
            });
        }
        next();
    }

    static validateLogin(req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void {
        const errors: Record<string, string[]> = {};
        const email = req.body.email;
        const password = req.body.password;

        if (typeof email !== 'string' || !ValidationManager.validateEmail(email)) {
            errors.email = ['Invalid email address'];
        }

        if (typeof password !== 'string' || password.length < 1) {
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

    static sanitize(): (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction) => void {
        return (req: TypedRequest, _res: Response<ErrorResponseBody>, next: NextFunction): void => {
            if (req.body) {
                req.sanitizedBody = ValidationManager.sanitizeInput(req.body);
            }
            next();
        };
    }

    static validateId(paramName: string = 'id'): (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction) => Response<ErrorResponseBody> | void {
        return (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void => {
            const rawId = req.params[paramName];
            const id = parseInt(String(rawId), 10);
            if (Number.isNaN(id) || id <= 0) {
                return res.status(400).json({
                    error: 'Invalid ID format',
                    details: { [paramName]: ['Must be a positive integer'] }
                });
            }
            req.params[paramName] = String(id);
            next();
        };
    }

    static validateQuery(rules: Record<string, QueryRule>): (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction) => Response<ErrorResponseBody> | void {
        return (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void => {
            const errors: Record<string, string[]> = {};

            Object.entries(rules).forEach(([key, rule]: [string, QueryRule]): void => {
                const value = req.query[key];

                if (rule.required && !value) {
                    errors[key] = [`${key} is required`];
                } else if (value) {
                    switch (rule.type) {
                        case 'number': {
                            const num = Number(value);
                            if (Number.isNaN(num)) {
                                errors[key] = [`${key} must be a number`];
                            } else if (rule.min !== undefined && num < rule.min) {
                                errors[key] = [`${key} must be at least ${rule.min}`];
                            } else if (rule.max !== undefined && num > rule.max) {
                                errors[key] = [`${key} must be at most ${rule.max}`];
                            }
                            break;
                        }
                        case 'string':
                            if (rule.enum && !rule.enum.includes(value)) {
                                errors[key] = [`${key} must be one of: ${rule.enum.join(', ')}`];
                            }
                            break;
                        case 'boolean':
                            if (!/^(true|false)$/i.test(value)) {
                                errors[key] = [`${key} must be true or false`];
                            }
                            break;
                        default:
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

    static validateFile(options: FileValidationOptions = {}): (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction) => Response<ErrorResponseBody> | void {
        return (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void => {
            if (!req.files || Object.keys(req.files).length === 0) {
                return res.status(400).json({
                    error: 'No files were uploaded',
                    details: { file: ['File is required'] }
                });
            }

            const file: UploadedFile = req.files.file;
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

    static validateApiVersion(): (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction) => Response<ErrorResponseBody> | void {
        return (req: TypedRequest, res: Response<ErrorResponseBody>, next: NextFunction): Response<ErrorResponseBody> | void => {
            const headerVersion = req.headers['accept-version'];
            const version = typeof headerVersion === 'string' ? headerVersion : undefined;
            const supportedVersions = VersionManager.getSupportedVersions();

            if (!version) {
                const latestVersion = supportedVersions
                    .filter((supportedVersion: string): boolean => !VersionManager.isDeprecated(supportedVersion))
                    .sort()
                    .pop();
                req.apiVersion = latestVersion;
                return next();
            }

            if (!supportedVersions.includes(version)) {
                return res.status(400).json({
                    error: 'Unsupported API version',
                    message: `Version ${version} is not supported`,
                    supportedVersions,
                    latest: supportedVersions[supportedVersions.length - 1]
                });
            }

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

module.exports = ValidationMiddleware;
module.exports.ValidationMiddleware = ValidationMiddleware;
