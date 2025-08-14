import express, { Request, Response, Router } from 'express';
import { AuthenticatedRequest, UserData, PaginatedResponse } from '../../../types';

// Import managers
const AuthManager = require('../../../managers/AuthManager');
const RoleManager = require('../../../managers/RoleManager');
const { userQueries } = require('../../../database/mainQueries');
const LogManager = require('../../../managers/LogManager');
const ValidationMiddleware = require('../../../managers/ValidationMiddleware');
const { RatelimitManager } = require('../../../managers/RatelimitManager');

const router: Router = express.Router();

// Profile update rate limiter
const profileUpdateLimiter = RatelimitManager.create({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many profile update requests, please try again later'
});

// Interface for query parameters
interface UsersQuery {
    page?: string;
    limit?: string;
}

// Interface for user update data
interface UserUpdateData {
    name?: string;
    email?: string;
    [key: string]: any;
}

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
    async (req: Request, res: Response) => {
        try {
            const query = req.query as UsersQuery;
            const page = parseInt(query.page || '1', 10);
            const limit = parseInt(query.limit || '10', 10);
            const offset = (page - 1) * limit;
            
            const users = await userQueries.getUsers(offset, limit);
            const totalCount = await userQueries.getUserCount();
            
            const response: PaginatedResponse<UserData> = {
                success: true,
                data: users,
                pagination: {
                    page,
                    limit,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit)
                }
            };
            
            res.json(response);
        } catch (error) {
            LogManager.error('Failed to fetch users', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch users' 
            });
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
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: User not found
 */
router.get('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const userId = parseInt(req.params.id, 10);
            const user = await userQueries.getUserById(userId);
            
            if (!user) {
                return res.status(404).json({ 
                    success: false,
                    error: 'User not found' 
                });
            }

            // Check if requesting user has permission to view this user
            if (req.user && req.user.id !== user.id && !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ 
                    success: false,
                    error: 'Insufficient permissions' 
                });
            }

            res.json({
                success: true,
                data: user
            });
        } catch (error) {
            LogManager.error('Failed to fetch user', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch user' 
            });
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
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       403:
 *         description: Insufficient permissions
 */
router.put('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    profileUpdateLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const userId = parseInt(req.params.id, 10);
            
            // Only allow users to update their own profile unless they're admin
            if (req.user && req.user.id !== userId && 
                !await RoleManager.hasRole(req.user.id, 'admin')) {
                return res.status(403).json({ 
                    success: false,
                    error: 'Insufficient permissions' 
                });
            }

            const updateData: UserUpdateData = req.body;
            const updatedUser = await userQueries.updateUser(userId, updateData);
            
            res.json({
                success: true,
                data: updatedUser,
                message: 'User updated successfully'
            });
        } catch (error) {
            LogManager.error('Failed to update user', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to update user' 
            });
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
 *       403:
 *         description: Insufficient permissions
 */
router.delete('/:id',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    ValidationMiddleware.validateId(),
    async (req: Request, res: Response) => {
        try {
            const userId = parseInt(req.params.id, 10);
            const result = await userQueries.deleteUser(userId);
            
            if (result) {
                res.json({ 
                    success: true,
                    message: 'User deleted successfully' 
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
        } catch (error) {
            LogManager.error('Failed to delete user', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to delete user' 
            });
        }
    }
);

export = router;