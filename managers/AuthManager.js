const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const LogManager = require('./LogManager');
const EmailManager = require('./EmailManager');
const RoleManager = require('./RoleManager');
const { userQueries } = require('../database/mainQueries');
const db = require('../database/db');
class AuthManager {
    constructor() {
        this.secret = process.env.JWT_SECRET || 'your-secret-key';
        this.tokenExpiration = process.env.JWT_EXPIRATION || '24h';
    }

    async hashPassword(password) {
        const salt = await bcrypt.genSalt(10);
        return bcrypt.hash(password, salt);
    }

    async comparePassword(password, hash) {
        return bcrypt.compare(password, hash);
    }

    async generateToken(user) {
        if (!user || !user.id) {
            LogManager.error('Invalid user object passed to generateToken', { user });
            throw new Error('Invalid user object');
        }

        const roles = await RoleManager.getUserRoles(user.id);
        // Ensure roles is an array and map it, defaulting to empty array if roles is falsy
        const roleNames = (roles || []).map(r => r.name);

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
        const hashedPassword = await this.hashPassword(userData.password);
        const result = await userQueries.createUser({
            ...userData,
            password: hashedPassword
        });

        // Assign default role
        const [roles] = await db.query('SELECT id FROM roles WHERE name = ?', [initialRole]);
        if (roles.length > 0) {
            await RoleManager.assignRole(result.insertId, roles[0].id);
        }

        return result.insertId;
    }

    requireRoles(roles) {
        return RoleManager.createRoleMiddleware(roles);
    }
}

module.exports = new AuthManager();