import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { 
    UserData, 
    RegistrationData, 
    AuthResult, 
    TokenVerificationResult, 
    EncryptionSettings, 
    AuthManagerConfig,
    AuthenticatedRequest 
} from '../types';

const LogManager = require('./LogManager');
const EmailManager = require('./EmailManager');
const RoleManager = require('./RoleManager');
const { userQueries } = require('../database/mainQueries');
const db = require('../database/db');
const WorkerThreadManager = require('./WorkerThreadManager');

interface JwtPayload {
    userId: number;
    email: string;
    iat?: number;
    exp?: number;
}

interface EncryptionResult {
    result: string;
    iv: string;
}

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

    /**
     * Hash password using worker threads instead of bcrypt
     */
    async hashPassword(password: string): Promise<string> {
        try {
            // Generate a random salt
            const salt = crypto.randomBytes(this.encryptionSettings.saltLength).toString('hex');
            
            // Use worker thread to perform CPU-intensive encryption
            const result: EncryptionResult = await WorkerThreadManager.executeTask('encryption', 
                {
                    text: password,
                    key: salt
                },
                {
                    operation: 'encrypt'
                }
            );
            
            // Format the hash with the salt for storage
            // Format: salt:iv:encrypted
            return `${salt}:${result.iv}:${result.result}`;
        } catch (error) {
            LogManager.error('Password hashing failed', error);
            throw new Error('Password hashing failed');
        }
    }

    /**
     * Compare password with hashed password using worker threads
     */
    async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
        try {
            const [salt, iv, encrypted] = hashedPassword.split(':');
            if (!salt || !iv || !encrypted) {
                return false;
            }

            // Use worker thread for decryption
            const result = await WorkerThreadManager.executeTask('encryption',
                {
                    encryptedText: encrypted,
                    key: salt,
                    iv: iv
                },
                {
                    operation: 'decrypt'
                }
            );

            return result.result === password;
        } catch (error) {
            LogManager.error('Password comparison failed', error);
            return false;
        }
    }

    /**
     * Generate JWT token for user
     */
    async generateToken(user: UserData): Promise<string> {
        try {
            const payload: JwtPayload = {
                userId: user.id,
                email: user.email
            };

            return jwt.sign(payload, this.secret, { 
                expiresIn: this.tokenExpiration 
            });
        } catch (error) {
            LogManager.error('Token generation failed', error);
            throw new Error('Token generation failed');
        }
    }

    /**
     * Verify JWT token
     */
    async verifyToken(token: string): Promise<TokenVerificationResult> {
        try {
            const decoded = jwt.verify(token, this.secret) as JwtPayload;
            const user = await userQueries.getUserById(decoded.userId);
            
            if (!user) {
                return { success: false };
            }

            return { success: true, user };
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return { success: false, expired: true };
            }
            return { success: false };
        }
    }

    /**
     * Generate email verification token
     */
    async generateVerificationToken(): Promise<string> {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Initiate email verification process
     */
    async initiateEmailVerification(user: UserData): Promise<void> {
        const token = await this.generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await userQueries.setEmailVerificationToken(user.id, token, expires);
        await EmailManager.sendVerificationEmail(user.email, token);
    }

    /**
     * Generate password reset token
     */
    async generatePasswordResetToken(): Promise<string> {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Initiate password reset process
     */
    async initiatePasswordReset(email: string): Promise<AuthResult> {
        try {
            const user = await userQueries.getUserByEmail(email);
            if (!user) {
                return { success: false, message: 'User not found' };
            }

            const token = await this.generatePasswordResetToken();
            const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            await userQueries.setPasswordResetToken(user.id, token, expires);
            await EmailManager.sendPasswordResetEmail(user.email, token);

            return { success: true };
        } catch (error) {
            LogManager.error('Password reset initiation failed', error);
            return { success: false, message: 'Password reset failed' };
        }
    }

    /**
     * Reset password using reset token
     */
    async resetPassword(token: string, newPassword: string): Promise<AuthResult> {
        try {
            const user = await userQueries.getUserByPasswordResetToken(token);
            if (!user) {
                return { success: false, message: 'Invalid or expired token' };
            }

            const hashedPassword = await this.hashPassword(newPassword);
            await userQueries.updatePassword(user.id, hashedPassword);

            return { success: true, user };
        } catch (error) {
            LogManager.error('Password reset failed', error);
            return { success: false, message: 'Password reset failed' };
        }
    }

    /**
     * Verify email using verification token
     */
    async verifyEmail(token: string): Promise<AuthResult> {
        try {
            const user = await userQueries.getUserByEmailVerificationToken(token);
            if (!user) {
                return { success: false, message: 'Invalid or expired token' };
            }

            await userQueries.verifyEmail(user.id);
            return { success: true, user };
        } catch (error) {
            LogManager.error('Email verification failed', error);
            return { success: false, message: 'Email verification failed' };
        }
    }

    /**
     * Authentication middleware
     */
    getAuthMiddleware(options: { roles?: string[] } = {}) {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            try {
                const token = req.headers.authorization?.split(' ')[1];
                
                if (!token) {
                    return res.status(401).json({ error: 'No token provided' });
                }

                const verificationResult = await this.verifyToken(token);
                if (!verificationResult.success) {
                    if (verificationResult.expired) {
                        return res.status(401).json({ error: 'Token expired' });
                    }
                    return res.status(401).json({ error: 'Invalid token' });
                }

                req.user = verificationResult.user;

                // Check role requirements if specified
                if (options.roles && options.roles.length > 0) {
                    const hasRequiredRole = await RoleManager.hasAnyRole(req.user!.id, options.roles);
                    if (!hasRequiredRole) {
                        return res.status(403).json({ error: 'Insufficient permissions' });
                    }
                }

                next();
            } catch (error) {
                LogManager.error('Authentication middleware error', error);
                res.status(500).json({ error: 'Authentication failed' });
            }
        };
    }

    /**
     * Register new user
     */
    async register(userData: RegistrationData): Promise<AuthResult> {
        try {
            const existingUser = await userQueries.getUserByEmail(userData.email);
            if (existingUser) {
                return { success: false, message: 'Email already exists' };
            }

            const hashedPassword = await this.hashPassword(userData.password);
            const userDataWithHashedPassword = {
                ...userData,
                password: hashedPassword
            };

            const result = await userQueries.createUser(userDataWithHashedPassword);
            const user = await userQueries.getUserById(result.insertId);

            // Assign default role
            await RoleManager.assignUserRole(user.id, 'user');

            // Initiate email verification
            await this.initiateEmailVerification(user);

            const token = await this.generateToken(user);

            return { success: true, user, token };
        } catch (error) {
            LogManager.error('User registration failed', error);
            return { success: false, message: 'Registration failed' };
        }
    }

    /**
     * Login user
     */
    async login(email: string, password: string): Promise<AuthResult> {
        try {
            const user = await userQueries.getUserByEmail(email);
            if (!user) {
                return { success: false, message: 'Invalid credentials' };
            }

            const passwordMatch = await this.comparePassword(password, user.password);
            if (!passwordMatch) {
                return { success: false, message: 'Invalid credentials' };
            }

            const token = await this.generateToken(user);

            // Remove password from user object before returning
            const { password: _, ...safeUser } = user;

            return { success: true, user: safeUser, token };
        } catch (error) {
            LogManager.error('User login failed', error);
            return { success: false, message: 'Login failed' };
        }
    }

    /**
     * Forgot password
     */
    async forgotPassword(email: string): Promise<AuthResult> {
        return this.initiatePasswordReset(email);
    }

    /**
     * Role middleware (delegates to RoleManager)
     */
    createRoleMiddleware(roles: string[]) {
        return RoleManager.createRoleMiddleware(roles);
    }
}

export = new AuthManager();