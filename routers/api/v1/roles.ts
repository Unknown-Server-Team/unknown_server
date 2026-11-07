import express, { Response, Router } from 'express';
import type { AuthenticatedRequest } from '../../../types/authManager';
import type { RoleRecord, UserRecord } from '../../../types';
import AuthManager from '../../../managers/AuthManager';
import RoleManager from '../../../managers/RoleManager';
import LogManager from '../../../managers/LogManager';
import ValidationMiddleware from '../../../managers/ValidationMiddleware';
import databaseQueries from '../../../database/mainQueries';

const { userQueries } = databaseQueries;

const ROLE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
const ADMIN_ROLE = 'admin';

const router: Router = express.Router();

const requireAdmin = AuthManager.getAuthMiddleware({ requireVerified: true, roles: [ADMIN_ROLE] });

const publicRole = (role: RoleRecord) => ({
    id: role.id,
    name: role.name,
    description: role.description ?? null
});

const sendError = (res: Response, status: number, error: string): void => {
    res.status(status).json({ success: false, error });
};

interface RoleTarget {
    user: UserRecord;
    role: RoleRecord;
    userRoles: RoleRecord[];
}

const resolveTarget = async (req: AuthenticatedRequest, res: Response): Promise<RoleTarget | null> => {
    const userId = parseInt(String(req.params.id), 10);
    const roleName = String(req.params.role);

    if (!ROLE_NAME_PATTERN.test(roleName)) {
        res.status(400).json({
            success: false,
            error: 'Invalid role name',
            details: { role: ['Must be 1-50 characters of letters, digits, "_" or "-"'] }
        });
        return null;
    }

    const user = await userQueries.getUserById(userId);
    if (!user) {
        sendError(res, 404, 'User not found');
        return null;
    }

    const role = await RoleManager.getRoleByName(roleName);
    if (!role) {
        sendError(res, 404, 'Role not found');
        return null;
    }

    const userRoles = await RoleManager.getUserRoles(userId);
    return { user, role, userRoles };
};

router.get('/roles',
    requireAdmin,
    async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const roles = await RoleManager.getRoles();
            res.json({ success: true, data: roles.map(publicRole) });
        } catch (error) {
            LogManager.error('Failed to list roles', error);
            sendError(res, 500, 'Failed to list roles');
        }
    }
);

router.get('/user/:id/roles',
    requireAdmin,
    ValidationMiddleware.validateId(),
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = parseInt(String(req.params.id), 10);
            const user = await userQueries.getUserById(userId);
            if (!user) {
                sendError(res, 404, 'User not found');
                return;
            }

            const roles = await RoleManager.getUserRoles(userId);
            res.json({ success: true, data: roles.map(publicRole) });
        } catch (error) {
            LogManager.error('Failed to get user roles', error);
            sendError(res, 500, 'Failed to get user roles');
        }
    }
);

router.post('/user/:id/roles/:role',
    requireAdmin,
    ValidationMiddleware.validateId(),
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const target = await resolveTarget(req, res);
            if (!target) {
                return;
            }

            const { user, role, userRoles } = target;
            if (userRoles.some((existing) => existing.id === role.id)) {
                sendError(res, 409, `User already has role '${role.name}'`);
                return;
            }

            await RoleManager.assignRole(user.id, role.id);
            LogManager.info('Role assigned by admin', { adminId: req.user?.id, userId: user.id, role: role.name });

            const roles = await RoleManager.getUserRoles(user.id);
            res.status(201).json({
                success: true,
                message: `Role '${role.name}' assigned to user ${user.id}`,
                data: roles.map(publicRole)
            });
        } catch (error) {
            LogManager.error('Failed to assign role', error);
            sendError(res, 500, 'Failed to assign role');
        }
    }
);

router.delete('/user/:id/roles/:role',
    requireAdmin,
    ValidationMiddleware.validateId(),
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const target = await resolveTarget(req, res);
            if (!target) {
                return;
            }

            const { user, role, userRoles } = target;
            if (!userRoles.some((existing) => existing.id === role.id)) {
                sendError(res, 404, `User does not have role '${role.name}'`);
                return;
            }

            if (role.name === ADMIN_ROLE && await userQueries.countUsersByRole(ADMIN_ROLE) <= 1) {
                sendError(res, 409, 'Cannot remove the admin role from the last admin');
                return;
            }

            await RoleManager.removeRole(user.id, role.id);
            LogManager.info('Role removed by admin', { adminId: req.user?.id, userId: user.id, role: role.name });

            const roles = await RoleManager.getUserRoles(user.id);
            res.json({
                success: true,
                message: `Role '${role.name}' removed from user ${user.id}`,
                data: roles.map(publicRole)
            });
        } catch (error) {
            LogManager.error('Failed to remove role', error);
            sendError(res, 500, 'Failed to remove role');
        }
    }
);

export = router;
