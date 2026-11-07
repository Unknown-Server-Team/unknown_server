import express, { Request, Response, Router } from 'express';
import type { UserData, PaginatedResponse, UserUpdateData } from '../../../types';
import type { AuthenticatedRequest } from '../../../types/authManager';
import AuthManager from '../../../managers/AuthManager';
import RoleManager from '../../../managers/RoleManager';
import ValidationManager from '../../../managers/ValidationManager';
import databaseQueries from '../../../database/mainQueries';
import LogManager from '../../../managers/LogManager';
import ValidationMiddleware from '../../../managers/ValidationMiddleware';
import { RatelimitManager } from '../../../managers/RatelimitManager';

const { userQueries } = databaseQueries;

const router: Router = express.Router();

const profileUpdateLimiter = RatelimitManager.create({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many profile update requests, please try again later'
});

interface UsersQuery {
    page?: string;
    limit?: string;
}

router.get('/',
    AuthManager.getAuthMiddleware({ requireVerified: true, roles: ['admin'] }),
    ValidationMiddleware.validateQuery({
        page: { type: 'number', min: 1 },
        limit: { type: 'number', min: 1, max: 100 }
    }),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const query = req.query as UsersQuery;
            const page = parseInt(query.page || '1', 10);
            const limit = parseInt(query.limit || '10', 10);
            const offset = (page - 1) * limit;
            
            const users = await userQueries.getUsers(offset, limit);
            const totalCount = await userQueries.getUserCount();
            
            const response: PaginatedResponse<UserData> = {
                success: true,
                data: users as unknown as UserData[],
                pagination: {
                    page,
                    limit,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit)
                }
            };
            
            res.json(response);
            return;
        } catch (error) {
            LogManager.error('Failed to fetch users', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch users' 
            });
            return;
        }
    }
);

router.get('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = parseInt(String(req.params.id), 10);
            const user = await userQueries.getUserById(userId);
            
            if (!user) {
                res.status(404).json({ 
                    success: false,
                    error: 'User not found' 
                });
                return;
            }

            if (req.user && req.user.id !== user.id && !await RoleManager.hasRole(req.user.id, 'admin')) {
                res.status(403).json({ 
                    success: false,
                    error: 'Insufficient permissions' 
                });
                return;
            }

            res.json({
                success: true,
                data: user
            });
            return;
        } catch (error) {
            LogManager.error('Failed to fetch user', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch user' 
            });
            return;
        }
    }
);

router.put('/:id',
    AuthManager.getAuthMiddleware(),
    ValidationMiddleware.validateId(),
    profileUpdateLimiter,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = parseInt(String(req.params.id), 10);

            if (req.user && req.user.id !== userId && 
                !await RoleManager.hasRole(req.user.id, 'admin')) {
                res.status(403).json({ 
                    success: false,
                    error: 'Insufficient permissions' 
                });
                return;
            }

            const { name, email } = req.body as UserUpdateData;
            if (email !== undefined && (typeof email !== 'string' || !ValidationManager.validateEmail(email))) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid email address'
                });
                return;
            }
            if (name !== undefined && (typeof name !== 'string' || !ValidationManager.validateName(name).isValid)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid name'
                });
                return;
            }

            const updatedUser = await userQueries.updateUser(userId, { name, email });
            if (!updatedUser) {
                res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
                return;
            }
            
            res.json({
                success: true,
                data: updatedUser,
                message: 'User updated successfully'
            });
            return;
        } catch (error) {
            LogManager.error('Failed to update user', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to update user' 
            });
            return;
        }
    }
);

router.delete('/:id',
    AuthManager.getAuthMiddleware({ requireVerified: true, roles: ['admin'] }),
    ValidationMiddleware.validateId(),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = parseInt(String(req.params.id), 10);
            const result = await userQueries.deleteUser(userId);
            
            if (result) {
                res.json({ 
                    success: true,
                    message: 'User deleted successfully' 
                });
                return;
            }

            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        } catch (error) {
            LogManager.error('Failed to delete user', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to delete user' 
            });
            return;
        }
    }
);

export = router;