const jwt = require('jsonwebtoken');
// Remove bcrypt dependency
const crypto = require('crypto');
const LogManager = require('./LogManager');
const EmailManager = require('./EmailManager');
const RoleManager = require('./RoleManager');
const { userQueries } = require('../database/mainQueries');
const db = require('../database/db');
const WorkerThreadManager = require('./WorkerThreadManager');

class AuthManager {
    constructor() {
        this.secret = process.env.JWT_SECRET || 'your-secret-key';
        this.tokenExpiration = process.env.JWT_EXPIRATION || '24h';
        // Add encryption settings to use with worker threads
        this.encryptionSettings = {
            saltLength: 16,
            keyAlgorithm: 'sha256',
            iterations: 10000,
            keyLength: 32
        };
    }

    /**
     * Hash password using worker threads instead of bcrypt
     * @param {string} password - The password to hash
     * @returns {Promise<string>} - Hashed password with salt
     */
    async hashPassword(password) {
        try {
            // Generate a random salt
            const salt = crypto.randomBytes(this.encryptionSettings.saltLength).toString('hex');
            
            // Use worker thread to perform CPU-intensive encryption
            const result = await WorkerThreadManager.executeTask('encryption', 
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
     * Compare plain text password with hashed password using worker threads
     * @param {string} password - The plain text password
     * @param {string} hashedPassword - The hashed password from database
     * @returns {Promise<boolean>} - True if password matches
     */
    async comparePassword(password, hashedPassword) {
        try {
            // Split the stored hash into components
            const [salt, iv, hash] = hashedPassword.split(':');
            
            if (!salt || !iv || !hash) {
                LogManager.error('Invalid password hash format');
                return false;
            }
            
            // Use worker thread to perform CPU-intensive decryption
            const result = await WorkerThreadManager.executeTask('encryption', 
                {
                    text: hash,
                    key: salt,
                    iv: iv
                },
                {
                    operation: 'decrypt'
                }
            );
            
            // Compare the decrypted password with the provided password
            return result.result === password;
        } catch (error) {
            LogManager.error('Password comparison failed', error);
            return false;
        }
    }

    async generateToken(user) {
        if (!user || !user.id) {
            LogManager.error('Invalid user object passed to generateToken', { user });
            throw new Error('Invalid user object');
        }

        const roles = await RoleManager.getUserRoles(user.id);
        // Ensure roles is always an array before mapping
        const roleArray = Array.isArray(roles) ? roles : [];
        // Map the array to get role names
        const roleNames = roleArray.map(r => r.name);

        return jwt.sign(
            { 
                id: user.id, 
                email: user.email,
                roles: roleNames
            },
            this.secret,
            { expiresIn: this.tokenExpiration }
        );
    }

    verifyToken(token) {
        try {
            return jwt.verify(token, this.secret);
        } catch (error) {
            LogManager.error('Token verification failed', error);
            return null;
        }
    }

    async generateVerificationToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    async initiateEmailVerification(user) {
        const token = await this.generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await userQueries.setVerificationToken(user.id, token, expires);
        await EmailManager.sendVerificationEmail(user, token);
    }

    async generatePasswordResetToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    async initiatePasswordReset(email) {
        const user = await userQueries.getUserByEmail(email);
        if (!user) return false;

        const token = await this.generatePasswordResetToken();
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await userQueries.setPasswordResetToken(user.id, token, expires);
        await EmailManager.sendPasswordResetEmail(user, token);
        return true;
    }

    async resetPassword(token, newPassword) {
        const user = await userQueries.getUserByResetToken(token);
        if (!user) return false;

        const hashedPassword = await this.hashPassword(newPassword);
        await userQueries.updatePassword(user.id, hashedPassword);
        return true;
    }

    async verifyEmail(token) {
        const user = await userQueries.verifyEmail(token);
        return !!user;
    }

    getAuthMiddleware(options = { requireVerified: true, roles: [] }) {
        return async (req, res, next) => {
            const token = this.extractToken(req);
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const decoded = this.verifyToken(token);
            if (!decoded) {
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

            // Attach full user object and roles to request
            req.user = user;
            req.userRoles = await RoleManager.getUserRoles(user.id);
            next();
        };
    }

    extractToken(req) {
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            return req.headers.authorization.substring(7);
        }
        return null;
    }

    async createUser(userData, initialRole = 'user') {
        try {
            // Hash password first
            const hashedPassword = await this.hashPassword(userData.password);
            
            // Create user with hashed password
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
                // Get default role and assign it
                const defaultRole = await RoleManager.getDefaultRole();
                if (!defaultRole) {
                    LogManager.error('Default role not found', { roleName: initialRole });
                    throw new Error('Default role not found');
                }

                await RoleManager.assignRole(userId, defaultRole.id);
                LogManager.info('User created with default role', { userId, roleId: defaultRole.id });

                // If additional roles were specified and this is a CLI request (has API key)
                if (userData.roles && Array.isArray(userData.roles)) {
                    for (const roleName of userData.roles) {
                        const [role] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
                        if (role) {
                            await RoleManager.assignRole(userId, role.id);
                        }
                    }
                }
            } catch (roleError) {
                // If role assignment fails, delete the user and throw
                await userQueries.deleteUser(userId);
                throw roleError;
            }

            return userId;
        } catch (error) {
            LogManager.error('Failed to create user', error);
            throw error;
        }
    }

    requireRoles(roles) {
        return RoleManager.createRoleMiddleware(roles);
    }
}

module.exports = new AuthManager();