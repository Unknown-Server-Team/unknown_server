const express = require('express');
const router = express.Router();
const AuthManager = require('../../managers/AuthManager');
const ValidationMiddleware = require('../../managers/ValidationMiddleware');
const { userQueries } = require('../../database/mainQueries');

/**
 * @swagger
 * components:
 *   schemas:
 *     UserProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: User ID
 *         email:
 *           type: string
 *           format: email
 *         name:
 *           type: string
 *         email_verified:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *         roles:
 *           type: array
 *           items:
 *             type: string
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get list of users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *     responses:
 *       200:
 *         description: List of users with pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserProfile'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *                     current:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/', 
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    ValidationMiddleware.validateQuery({
        page: { type: 'number', min: 1 },
        limit: { type: 'number', min: 1, max: 100 }
    }),
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [users, total] = await Promise.all([
                userQueries.getUsers(offset, limit),
                userQueries.getUserCount()
            ]);

            const sanitizedUsers = users.map(user => ValidationManager.sanitizeUser(user));

            res.json({
                users: sanitizedUsers,
                pagination: {
                    total,
                    pages: Math.ceil(total / limit),
                    current: page,
                    limit
                }
            });
        } catch (error) {
            LogManager.error('Failed to fetch users', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       404:
 *         description: User not found
 */
router.get('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    async (req, res) => {
        try {
            const user = await userQueries.getUserById(req.params.id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Users can only view their own profile unless they're admin
            if (req.params.id !== req.user.id && !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const sanitizedUser = ValidationManager.sanitizeUser(user);
            const roles = await RoleManager.getUserRoles(user.id);
            
            res.json({
                ...sanitizedUser,
                roles
            });
        } catch (error) {
            LogManager.error('Failed to fetch user', error);
            res.status(500).json({ error: 'Failed to fetch user' });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}:
 *   patch:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Invalid input data
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: User not found
 */
router.patch('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    async (req, res) => {
        try {
            // Users can only update their own profile unless they're admin
            if (req.params.id !== req.user.id && !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const { name, email } = req.body;
            const updates = {};

            if (name !== undefined) {
                const nameValidation = ValidationManager.validateName(name);
                if (!nameValidation.isValid) {
                    return res.status(400).json({ 
                        error: 'Invalid name',
                        details: { name: nameValidation.errors }
                    });
                }
                updates.name = name;
            }

            if (email !== undefined) {
                if (!ValidationManager.validateEmail(email)) {
                    return res.status(400).json({ 
                        error: 'Invalid email',
                        details: { email: ['Invalid email format'] }
                    });
                }
                updates.email = email;
                updates.email_verified = false; // Require re-verification for new email
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid updates provided' });
            }

            const success = await userQueries.updateUser(req.params.id, updates);
            if (!success) {
                return res.status(404).json({ error: 'User not found' });
            }

            // If email was updated, send verification
            if (updates.email) {
                const user = await userQueries.getUserById(req.params.id);
                await AuthManager.initiateEmailVerification(user);
            }

            res.json({ message: 'User updated successfully' });
        } catch (error) {
            LogManager.error('Failed to update user', error);
            res.status(500).json({ error: 'Failed to update user' });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: User not found
 */
router.delete('/:id',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    ValidationMiddleware.validateId(),
    async (req, res) => {
        try {
            // Prevent deleting the last admin
            const isAdmin = await RoleManager.hasRole(req.params.id, 'admin');
            if (isAdmin) {
                const adminCount = await userQueries.countUsersByRole('admin');
                if (adminCount <= 1) {
                    return res.status(400).json({ error: 'Cannot delete the last admin user' });
                }
            }

            const success = await userQueries.deleteUser(req.params.id);
            if (!success) {
                return res.status(404).json({ error: 'User not found' });
            }

            await SessionManager.invalidateUserSessions(req.params.id);
            
            res.json({ message: 'User deleted successfully' });
        } catch (error) {
            LogManager.error('Failed to delete user', error);
            res.status(500).json({ error: 'Failed to delete user' });
        }
    }
);

module.exports = router;