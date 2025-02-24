const express = require('express');
const router = express.Router();
const AuthManager = require('../../../managers/AuthManager');
const RoleManager = require('../../../managers/RoleManager');
const { userQueries } = require('../../../database/mainQueries');
const LogManager = require('../../../managers/LogManager');
const ValidationMiddleware = require('../../../managers/ValidationMiddleware');
const { RatelimitManager } = require('../../../managers/RatelimitManager');

// Profile update rate limiter
const profileUpdateLimiter = RatelimitManager.create({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many profile update requests, please try again later'
});

/**
 * @swagger
 * /api/v1/users:
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
 *         description: List of users
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
            const users = await userQueries.getUsers(page, limit);
            
            res.json(users);
        } catch (error) {
            LogManager.error('Failed to fetch users', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    }
);

/**
 * @swagger
 * /api/v1/users/{id}:
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
 *         description: User details
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

            // Check if requesting user has permission to view this user
            if (req.user.id !== user.id && !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            res.json(user);
        } catch (error) {
            LogManager.error('Failed to fetch user', error);
            res.status(500).json({ error: 'Failed to fetch user' });
        }
    }
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   put:
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
 *             $ref: '#/components/schemas/UserUpdate'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    profileUpdateLimiter,
    async (req, res) => {
        try {
            // Only allow users to update their own profile unless they're admin
            if (req.user.id !== parseInt(req.params.id) && 
                !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const updatedUser = await userQueries.updateUser(req.params.id, req.body);
            res.json(updatedUser);
        } catch (error) {
            LogManager.error('Failed to update user', error);
            res.status(500).json({ error: 'Failed to update user' });
        }
    }
);

/**
 * @swagger
 * /api/v1/users/{id}:
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
 */
router.delete('/:id',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    ValidationMiddleware.validateId(),
    async (req, res) => {
        try {
            await userQueries.deleteUser(req.params.id);
            res.json({ message: 'User deleted successfully' });
        } catch (error) {
            LogManager.error('Failed to delete user', error);
            res.status(500).json({ error: 'Failed to delete user' });
        }
    }
);

module.exports = router;