import express, { Request, Response, Router, NextFunction } from 'express';
import type { CliRequest, LoginData, RegistrationData, RateLimiterConfig, UserRecord } from '../../../types';
import type { AuthenticatedRequest } from '../../../types/authManager';
import AuthManager from '../../../managers/AuthManager';
import RoleManager from '../../../managers/RoleManager';
import PermissionManager from '../../../managers/PermissionManager';
import ValidationManager from '../../../managers/ValidationManager';
import LogManager from '../../../managers/LogManager';
import ValidationMiddleware from '../../../managers/ValidationMiddleware';
import AuthAnalytics from '../../../managers/AuthAnalytics';
import { RatelimitManager } from '../../../managers/RatelimitManager';
import SessionManager from '../../../managers/SessionManager';
import AuthMonitor from '../../../managers/AuthMonitor';
import WebsocketManager from '../../../managers/WebsocketManager';

const clientIp = (req: Request): string => req.ip ?? '';

const publicUser = (user: UserRecord) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    email_verified: user.email_verified
});

const router: Router = express.Router();
const validateCliApiKey = (req: Request, _res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-cli-api-key'] as string;
    const validApiKey = process.env.CLI_API_KEY;
    
    if (!validApiKey) {
        LogManager.warning('CLI_API_KEY not set in environment');
        (req as CliRequest).isCliRequest = false;
        return next();
    }
    
    if (apiKey === validApiKey) {
        (req as CliRequest).isCliRequest = true;
        LogManager.info('Valid CLI API key used', { ip: req.ip });
    } else {
        (req as CliRequest).isCliRequest = false;
    }
    
    next();
};

const loginLimiterConfig: RateLimiterConfig = {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts, please try again later',
    burstMultiplier: 1.5,
    onLimitReached: (req: Request) => {
        const ip = clientIp(req);
        AuthMonitor.trackLoginAttempt(false, ip);
        WebsocketManager.notifySecurityEvent('login_rate_limit', { ip });
        LogManager.warning('Login rate limit exceeded', { ip });
    }
};

const registrationLimiterConfig: RateLimiterConfig = {
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: 'Too many accounts created from this IP',
    burstMultiplier: 1,
    onLimitReached: (req: Request) => {
        const ip = clientIp(req);
        WebsocketManager.notifySecurityEvent('registration_rate_limit', { ip });
        LogManager.warning('Registration rate limit exceeded', { ip });
    }
};

const passwordResetLimiterConfig: RateLimiterConfig = {
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: 'Too many password reset requests',
    burstMultiplier: 1,
    onLimitReached: (req: Request) => {
        const ip = clientIp(req);
        WebsocketManager.notifySecurityEvent('password_reset_rate_limit', { ip });
        LogManager.warning('Password reset rate limit exceeded', { ip });
    }
};

const loginLimiter = RatelimitManager.create(loginLimiterConfig);
const registrationLimiter = RatelimitManager.create(registrationLimiterConfig);
const passwordResetLimiter = RatelimitManager.create(passwordResetLimiterConfig);

const trackAnalytics = (action: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
        res.on('finish', () => {
            const success = res.statusCode >= 200 && res.statusCode < 400;
            AuthAnalytics.track(action, {
                success,
                statusCode: res.statusCode,
                ip: clientIp(req),
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            });
        });
        next();
    };
};

router.post('/register',
    ValidationMiddleware.validateRegistration,
    registrationLimiter,
    validateCliApiKey,
    trackAnalytics('register'),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const body = req.body as RegistrationData;
            const validation = ValidationManager.validateRegistration(body);
            if (!validation.isValid) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.errors
                });
                return;
            }

            const isCliRequest = (req as unknown as CliRequest).isCliRequest;
            const requestedRoles = Array.isArray(body.roles) ? body.roles : undefined;

            if (!isCliRequest && requestedRoles) {
                LogManager.warning('Attempt to assign custom roles without valid CLI API key', {
                    ip: clientIp(req),
                    roles: requestedRoles
                });
            }

            const result = await AuthManager.register({
                name: body.name,
                email: body.email,
                password: body.password,
                roles: isCliRequest ? requestedRoles : undefined
            });

            if (!result.success || !result.user) {
                const status = result.message === 'Email already exists' ? 409 : 400;
                res.status(status).json({ error: result.message });
                return;
            }

            if (isCliRequest && requestedRoles && requestedRoles.length > 0) {
                LogManager.info('Custom roles assigned via CLI', {
                    userId: result.user.id,
                    roles: requestedRoles,
                    ip: clientIp(req)
                });
            }

            AuthAnalytics.track('user_registered', {
                userId: result.user.id,
                ip: clientIp(req)
            });

            WebsocketManager.notifyAuthEvent('user_registered', {
                userId: result.user.id,
                email: result.user.email
            });

            res.status(201).json({
                message: 'User registered successfully',
                token: result.token,
                user: publicUser(result.user)
            });
        } catch (error) {
            LogManager.error('Registration error', error);
            res.status(500).json({ error: 'Registration failed' });
        }
    }
);

router.post('/login',
    ValidationMiddleware.validateLogin,
    loginLimiter,
    trackAnalytics('login'),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password } = req.body as LoginData;

            const result = await AuthManager.login(email, password);

            if (!result.success || !result.user) {
                AuthMonitor.trackLoginAttempt(false, clientIp(req));
                res.status(401).json({ error: result.message });
                return;
            }

            AuthMonitor.trackLoginAttempt(true, clientIp(req), result.user.id);

            const sessionId = await SessionManager.createSession(result.user.id, {
                ip: clientIp(req),
                userAgent: req.get('User-Agent')
            });

            res.cookie('sessionId', sessionId, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            AuthAnalytics.track('user_login', {
                userId: result.user.id,
                ip: clientIp(req)
            });

            WebsocketManager.notifyAuthEvent('user_login', {
                userId: result.user.id,
                email: result.user.email
            });

            res.json({
                token: result.token,
                user: publicUser(result.user),
                expiresIn: 24 * 60 * 60
            });
        } catch (error) {
            LogManager.error('Login error', error);
            AuthMonitor.trackLoginAttempt(false, clientIp(req));
            res.status(500).json({ error: 'Login failed' });
        }
    }
);

router.get('/me', AuthManager.getAuthMiddleware({ requireVerified: false, roles: [] }), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const [roles, permissions] = await Promise.all([
            RoleManager.getUserRoles(req.user.id),
            PermissionManager.getUserPermissions(req.user.id)
        ]);

        res.json({
            user: req.user,
            roles,
            permissions
        });
    } catch (error) {
        LogManager.error('Get user profile error', error);
        res.status(500).json({ error: 'Failed to get user profile' });
    }
});

router.get('/verify-email/:token', async (req: Request, res: Response): Promise<void> => {
    try {
        const { token } = req.params;

        if (!token) {
            res.status(400).json({ error: 'Token is required' });
            return;
        }

        const user = await AuthManager.verifyEmail(token);

        if (!user) {
            res.status(400).json({ error: 'Invalid or expired verification token' });
            return;
        }

        WebsocketManager.notifyAuthEvent('email_verified', {
            userId: user.id,
            email: user.email
        });

        res.json({ message: 'Email verified successfully' });
    } catch (error) {
        LogManager.error('Email verification error', error);
        res.status(500).json({ error: 'Email verification failed' });
    }
});

router.post('/forgot-password',
    passwordResetLimiter,
    trackAnalytics('forgot_password'),
    async (req: Request, res: Response): Promise<void> => {
        const genericResponse = { message: 'If the email exists, a password reset link has been sent' };
        try {
            const { email } = req.body as { email?: string };

            if (!email) {
                res.status(400).json({ error: 'Email is required' });
                return;
            }

            const initiated = await AuthManager.initiatePasswordReset(email);
            res.json(genericResponse);

            if (initiated) {
                AuthAnalytics.track('password_reset_requested', {
                    email,
                    ip: clientIp(req)
                });
            }
        } catch (error) {
            LogManager.error('Forgot password error', error);
            res.json(genericResponse);
        }
    }
);

router.post('/reset-password/:token',
    passwordResetLimiter,
    trackAnalytics('reset_password'),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const { token } = req.params;
            const { password } = req.body as { password?: string };

            if (!token || !password) {
                res.status(400).json({ error: 'Token and password are required' });
                return;
            }

            const passwordValidation = ValidationManager.validatePassword(password);
            if (!passwordValidation.isValid) {
                res.status(400).json({
                    error: 'Password validation failed',
                    details: passwordValidation.errors
                });
                return;
            }

            const user = await AuthManager.resetPassword(token, password);

            if (!user) {
                res.status(400).json({ error: 'Invalid or expired reset token' });
                return;
            }

            AuthAnalytics.track('password_reset_completed', {
                userId: user.id,
                ip: clientIp(req)
            });

            WebsocketManager.notifyAuthEvent('password_reset', {
                userId: user.id,
                email: user.email
            });

            res.json({ message: 'Password reset successfully' });
        } catch (error) {
            LogManager.error('Reset password error', error);
            res.status(500).json({ error: 'Password reset failed' });
        }
    }
);

export = router;
