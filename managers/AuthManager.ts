import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import type {
    VerificationEmailUser,
    WorkerThreadManagerModule,
    EncryptionSettings,
    JwtPayload,
    AuthenticatedRequest,
    AuthMiddlewareOptions,
    CreateUserInput,
    UserQueriesModule
} from '../types/authManager';
import type { RoleManagerModule, EmailManagerModule, DatabaseModule } from '../types/modules';
import LogManager from './LogManager';
import EmailManagerImport from './EmailManager';
import RoleManagerImport from './RoleManager';
import databaseQueries from '../database/mainQueries';
import dbImport from '../database/db';
import WorkerThreadManagerImport from './WorkerThreadManager';

const EmailManager = EmailManagerImport as unknown as EmailManagerModule;
const RoleManager = RoleManagerImport as unknown as RoleManagerModule;
const { userQueries } = databaseQueries as unknown as { userQueries: UserQueriesModule };
const db = dbImport as unknown as DatabaseModule;
const WorkerThreadManager = WorkerThreadManagerImport as unknown as WorkerThreadManagerModule;

class AuthManager {
    private secret: string;
    private tokenExpiration: string;
    private encryptionSettings: EncryptionSettings;

    constructor() {
        this.secret = process.env.JWT_SECRET || 'your-secret-key';
        this.tokenExpiration = process.env.JWT_EXPIRATION || '24h';
        this.encryptionSettings = {
            saltLength: 16,
            keyAlgorithm: 'sha256',
            iterations: 10000,
            keyLength: 32
        };
    }

    async hashPassword(password: string): Promise<string> {
        try {
            const salt = crypto.randomBytes(this.encryptionSettings.saltLength).toString('hex');
            const result = await WorkerThreadManager.executeTask(
                'encryption',
                {
                    text: password,
                    key: salt
                },
                {
                    operation: 'encrypt'
                }
            );
            return `${salt}:${result.iv}:${result.result}`;
        } catch (error: unknown) {
            LogManager.error('Password hashing failed', error instanceof Error ? error : new Error(String(error)));
            throw new Error('Password hashing failed');
        }
    }

    async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
        try {
            const [salt, iv, hash] = hashedPassword.split(':');

            if (!salt || !iv || !hash) {
                LogManager.error('Invalid password hash format');
                return false;
            }

            const result = await WorkerThreadManager.executeTask(
                'encryption',
                {
                    text: hash,
                    key: salt,
                    iv
                },
                {
                    operation: 'decrypt'
                }
            );

            return result.result === password;
        } catch (error: unknown) {
            LogManager.error('Password comparison failed', error instanceof Error ? error : new Error(String(error)));
            return false;
        }
    }

    async generateToken(user: VerificationEmailUser): Promise<string> {
        if (!user || !user.id) {
            LogManager.error('Invalid user object passed to generateToken');
            throw new Error('Invalid user object');
        }

        const roles = await RoleManager.getUserRoles(user.id);
        const roleArray = Array.isArray(roles) ? roles as Array<{ name: string }> : [];
        const roleNames = roleArray.map((role): string => role.name);

        return jwt.sign(
            {
                id: user.id,
                email: user.email,
                roles: roleNames
            },
            this.secret,
            { expiresIn: this.tokenExpiration as SignOptions['expiresIn'] }
        );
    }

    verifyToken(token: string): string | JwtPayload | null {
        try {
            return jwt.verify(token, this.secret) as JwtPayload;
        } catch (error: unknown) {
            LogManager.error('Token verification failed', error instanceof Error ? error : new Error(String(error)));
            return null;
        }
    }

    async generateVerificationToken(): Promise<string> {
        return crypto.randomBytes(32).toString('hex');
    }

    async initiateEmailVerification(user: VerificationEmailUser): Promise<void> {
        const token = await this.generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await userQueries.setVerificationToken(user.id, token, expires);
        await EmailManager.sendVerificationEmail(user, token);
    }

    async generatePasswordResetToken(): Promise<string> {
        return crypto.randomBytes(32).toString('hex');
    }

    async initiatePasswordReset(email: string): Promise<boolean> {
        const user = await userQueries.getUserByEmail(email);
        if (!user) {
            return false;
        }

        const token = await this.generatePasswordResetToken();
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await userQueries.setPasswordResetToken(user.id, token, expires);
        await EmailManager.sendPasswordResetEmail(user, token);
        return true;
    }

    async resetPassword(token: string, newPassword: string): Promise<boolean> {
        const user = await userQueries.getUserByResetToken(token);
        if (!user) {
            return false;
        }

        const hashedPassword = await this.hashPassword(newPassword);
        await userQueries.updatePassword(user.id, hashedPassword);
        return true;
    }

    async verifyEmail(token: string): Promise<boolean> {
        const user = await userQueries.verifyEmail(token);
        return !!user;
    }

    getAuthMiddleware(options: AuthMiddlewareOptions = { requireVerified: true, roles: [] }): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response | void> {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<Response | void> => {
            const token = this.extractToken(req);
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const decoded = this.verifyToken(token);
            if (!decoded || typeof decoded === 'string') {
                return res.status(401).json({ error: 'Invalid token' });
            }

            const user = await userQueries.getUserById(decoded.id);
            if (!user) {
                return res.status(401).json({ error: 'User not found' });
            }

            if (options.requireVerified && !user.email_verified) {
                return res.status(403).json({
                    error: 'Email not verified',
                    verificationRequired: true
                });
            }

            if (options.roles && options.roles.length > 0) {
                const hasRequiredRole = await RoleManager.hasAnyRole(user.id, options.roles);
                if (!hasRequiredRole) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
            }

            req.user = user;
            req.userRoles = await RoleManager.getUserRoles(user.id);
            next();
        };
    }

    extractToken(req: AuthenticatedRequest): string | null {
        const authorization = req.headers.authorization;
        if (authorization && authorization.startsWith('Bearer ')) {
            return authorization.substring(7);
        }
        return null;
    }

    async createUser(userData: CreateUserInput, _initialRole: string = 'user'): Promise<number> {
        try {
            const hashedPassword = await this.hashPassword(userData.password);
            const result = await userQueries.createUser({
                email: userData.email,
                password: hashedPassword,
                name: userData.name
            });

            if (!result || !result.insertId) {
                throw new Error('Failed to create user record');
            }

            const userId = result.insertId;

            try {
                const defaultRole = await RoleManager.getDefaultRole();
                if (!defaultRole) {
                    LogManager.error('Default role not found');
                    throw new Error('Default role not found');
                }

                await RoleManager.assignRole(userId, defaultRole.id);
                LogManager.info('User created with default role', { userId, roleId: defaultRole.id });

                if (userData.roles && Array.isArray(userData.roles)) {
                    for (const roleName of userData.roles) {
                        const [role] = await db.query<Array<{ id: number }>>('SELECT id FROM roles WHERE name = ?', [roleName]);
                        if (role) {
                            await RoleManager.assignRole(userId, role.id);
                        }
                    }
                }
            } catch (roleError: unknown) {
                await userQueries.deleteUser(userId);
                throw roleError;
            }

            return userId;
        } catch (error: unknown) {
            LogManager.error('Failed to create user', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    requireRoles(roles: string[]): (...args: unknown[]) => unknown {
        return RoleManager.createRoleMiddleware(roles);
    }
}

const authManager = new AuthManager();

export = authManager;
