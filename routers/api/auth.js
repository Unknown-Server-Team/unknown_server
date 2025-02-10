const express = require('express');
const router = express.Router();
const AuthManager = require('../../managers/AuthManager');
const RoleManager = require('../../managers/RoleManager');
const PermissionManager = require('../../managers/PermissionManager');
const ValidationManager = require('../../managers/ValidationManager');
const { userQueries } = require('../../database/mainQueries');
const RatelimitManager = require('../../managers/RatelimitManager');
const LogManager = require('../../managers/LogManager');
const ValidationMiddleware = require('../../managers/ValidationMiddleware');

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           format: password
 *         name:
 *           type: string
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid input data
 *       409:
 *         description: Email already exists
 *       500:
 *         description: Server error
 */
router.post('/register',
    ValidationMiddleware.validateRegistration,
    RatelimitManager.createAuthLimiter(),
    async (req, res) => {
        try {
            const validation = ValidationManager.validateRegistration(req.body);
            if (!validation.isValid) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: validation.errors
                });
            }
            const foundUser = await userQueries.getUserByEmail(req.body.email);
            if (foundUser) {
                return res.status(409).json({ error: 'Email already exists' });
            }
            const userId = await AuthManager.createUser(req.body);
            const user = await userQueries.getUserById(userId);

            try {
                // Generate verification token and send email
                await AuthManager.initiateEmailVerification(user);
            }
            catch (error) {
                LogManager.error('Failed to send verification email', error);
            }

            // Get initial roles and permissions
            const userAuth = await RoleManager.getUserWithRolesAndPermissions(userId);

            res.status(201).json({
                message: 'User registered successfully. Please check your email to verify your account.',
                userId,
                roles: userAuth.roles,
                permissions: userAuth.permissions
            });
        } catch (error) {
            LogManager.error('Registration failed', error);
            res.status(500).json({ error: 'Registration failed' });
        }
    }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Login user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post('/login', ValidationMiddleware.validateLogin, RatelimitManager.createAuthLimiter(), async (req, res) => {
    try {
        const { email, password } = req.body;

        // Get user
        const user = await userQueries.getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const isValid = await AuthManager.comparePassword(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = await AuthManager.generateToken(user);

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get current user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *       401:
 *         description: Not authenticated
 */
router.get('/me', AuthManager.getAuthMiddleware(), async (req, res) => {
    try {
        const user = await userQueries.getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const roles = await RoleManager.getUserRoles(req.user.id);
        const sanitizedUser = ValidationManager.sanitizeUser(user);

        res.json({
            ...sanitizedUser,
            roles
        });
    } catch (error) {
        LogManager.error('Failed to get user profile', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

/**
 * @swagger
 * /api/auth/verify-email/{token}:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Verify email address
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */
router.get('/verify-email/:token', async (req, res) => {
    try {
        const isVerified = await AuthManager.verifyEmail(req.params.token);
        if (isVerified) {
            res.json({ message: 'Email verified successfully' });
        } else {
            res.status(400).json({ error: 'Invalid or expired verification token' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to verify email' });
    }
});

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request password reset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset email sent
 *       404:
 *         description: User not found
 */
router.post('/forgot-password', RatelimitManager.createAuthLimiter(), async (req, res) => {
    try {
        const { email } = req.body;
        if (!ValidationManager.validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const initiated = await AuthManager.initiatePasswordReset(email);
        res.json({ message: 'If an account exists with this email, a password reset link has been sent' });
    } catch (error) {
        LogManager.error('Password reset request failed', error);
        res.status(500).json({ error: 'Failed to process password reset request' });
    }
});

/**
 * @swagger
 * /api/auth/reset-password/{token}:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Reset password using token
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 minimum: 8
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password/:token', RatelimitManager.createAuthLimiter(), async (req, res) => {
    try {
        const { token } = req.params;
        const { newPassword } = req.body;

        const passwordValidation = ValidationManager.validatePassword(newPassword);
        if (!passwordValidation.isValid) {
            return res.status(400).json({
                error: 'Invalid password',
                details: passwordValidation.errors
            });
        }

        const isReset = await AuthManager.resetPassword(token, newPassword);
        if (isReset) {
            res.json({ message: 'Password reset successful' });
            LogManager.info('Password reset successful', { token: token.substring(0, 8) + '...' });
        } else {
            res.status(400).json({ error: 'Invalid or expired reset token' });
        }
    } catch (error) {
        LogManager.error('Password reset failed', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Resend verification email
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification email sent
 *       403:
 *         description: Email already verified
 */
router.post('/resend-verification',
    AuthManager.getAuthMiddleware({ requireVerified: false }),
    RatelimitManager.createAuthLimiter(),
    async (req, res) => {
        try {
            const user = await userQueries.getUserById(req.user.id);

            if (user.email_verified) {
                return res.status(403).json({ error: 'Email already verified' });
            }

            await AuthManager.initiateEmailVerification(user);
            res.json({ message: 'Verification email sent' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to send verification email' });
        }
    }
);

/**
 * @swagger
 * /api/auth/roles:
 *   get:
 *     tags:
 *       - Authorization
 *     summary: Get all available roles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of roles
 *       403:
 *         description: Insufficient permissions
 */
router.get('/roles',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    async (req, res) => {
        try {
            const roles = await RoleManager.getRoles();
            res.json(roles);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch roles' });
        }
    }
);

/**
 * @swagger
 * /api/auth/user/{userId}/roles:
 *   get:
 *     tags:
 *       - Authorization
 *     summary: Get user roles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User roles
 *       403:
 *         description: Insufficient permissions
 */
router.get('/user/:userId/roles',
    AuthManager.getAuthMiddleware(),
    async (req, res) => {
        try {
            // Users can only view their own roles unless they're admin
            if (req.params.userId != req.user.id && !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const roles = await RoleManager.getUserRoles(req.params.userId);
            res.json(roles);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch user roles' });
        }
    }
);

/**
 * @swagger
 * /api/auth/user/{userId}/roles/{roleId}:
 *   post:
 *     tags:
 *       - Authorization
 *     summary: Assign role to user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role assigned successfully
 *       403:
 *         description: Insufficient permissions
 */
router.post('/user/:userId/roles/:roleId',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    async (req, res) => {
        try {
            await RoleManager.assignRole(req.params.userId, req.params.roleId);
            res.json({ message: 'Role assigned successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to assign role' });
        }
    }
);

/**
 * @swagger
 * /api/auth/user/{userId}/roles/{roleId}:
 *   delete:
 *     tags:
 *       - Authorization
 *     summary: Remove role from user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role removed successfully
 *       403:
 *         description: Insufficient permissions
 */
router.delete('/user/:userId/roles/:roleId',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    async (req, res) => {
        try {
            // Prevent removing the last admin role
            if (await RoleManager.hasRole(req.params.userId, 'admin')) {
                const roles = await RoleManager.getUserRoles(req.params.userId);
                const adminRoles = roles.filter(r => r.name === 'admin');
                if (adminRoles.length === 1 && adminRoles[0].id === parseInt(req.params.roleId)) {
                    return res.status(400).json({ error: 'Cannot remove the last admin role' });
                }
            }

            await RoleManager.removeRole(req.params.userId, req.params.roleId);
            res.json({ message: 'Role removed successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to remove role' });
        }
    }
);

/**
 * @swagger
 * /api/auth/permissions:
 *   get:
 *     tags:
 *       - Authorization
 *     summary: Get all permissions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of permissions
 */
router.get('/permissions',
    AuthManager.getAuthMiddleware(),
    RoleManager.createRoleAndPermissionMiddleware(['admin', 'moderator'], ['permission:read']),
    async (req, res) => {
        try {
            const permissions = await PermissionManager.getPermissions();
            res.json(permissions);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch permissions' });
        }
    }
);

/**
 * @swagger
 * /api/auth/roles/{roleId}/permissions:
 *   get:
 *     tags:
 *       - Authorization
 *     summary: Get permissions for a role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role permissions
 */
router.get('/roles/:roleId/permissions',
    AuthManager.getAuthMiddleware(),
    RoleManager.createRoleAndPermissionMiddleware(['admin', 'moderator'], ['permission:read']),
    async (req, res) => {
        try {
            const permissions = await PermissionManager.getRolePermissions(req.params.roleId);
            res.json(permissions);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch role permissions' });
        }
    }
);

/**
 * @swagger
 * /api/auth/roles/{roleId}/permissions/{permissionId}:
 *   post:
 *     tags:
 *       - Authorization
 *     summary: Assign permission to role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: permissionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Permission assigned successfully
 */
router.post('/roles/:roleId/permissions/:permissionId',
    AuthManager.getAuthMiddleware(),
    RoleManager.createRoleAndPermissionMiddleware(['admin'], ['permission:write']),
    async (req, res) => {
        try {
            await PermissionManager.assignPermissionToRole(
                req.params.roleId,
                req.params.permissionId
            );
            res.json({ message: 'Permission assigned successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to assign permission' });
        }
    }
);

/**
 * @swagger
 * /api/auth/roles/{roleId}/permissions/{permissionId}:
 *   delete:
 *     tags:
 *       - Authorization
 *     summary: Remove permission from role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: permissionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Permission removed successfully
 */
router.delete('/roles/:roleId/permissions/:permissionId',
    AuthManager.getAuthMiddleware(),
    RoleManager.createRoleAndPermissionMiddleware(['admin'], ['permission:write']),
    async (req, res) => {
        try {
            // Prevent removing critical permissions from admin role
            const [[role]] = await db.query('SELECT name FROM roles WHERE id = ?', [req.params.roleId]);
            if (role?.name === 'admin') {
                const [[permission]] = await db.query(
                    'SELECT name FROM permissions WHERE id = ?',
                    [req.params.permissionId]
                );
                if (permission?.name === 'system:admin') {
                    return res.status(400).json({
                        error: 'Cannot remove system:admin permission from admin role'
                    });
                }
            }

            await PermissionManager.removePermissionFromRole(
                req.params.roleId,
                req.params.permissionId
            );
            res.json({ message: 'Permission removed successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to remove permission' });
        }
    }
);

/**
 * @swagger
 * /api/auth/my-permissions:
 *   get:
 *     tags:
 *       - Authorization
 *     summary: Get current user's permissions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User permissions
 */
router.get('/my-permissions',
    AuthManager.getAuthMiddleware(),
    async (req, res) => {
        try {
            const permissions = await PermissionManager.getUserPermissions(req.user.id);
            res.json(permissions);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch user permissions' });
        }
    }
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout current user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/logout', AuthManager.getAuthMiddleware(), async (req, res) => {
    try {
        // If there's a session, invalidate it
        if (req.session) {
            await SessionManager.invalidateSession(req.session.id);
        }

        // If there's a token, add it to blacklist
        const token = AuthManager.extractToken(req);
        if (token) {
            await AuthMonitor.removeToken(token);
        }

        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        LogManager.error('Logout failed', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

module.exports = router;