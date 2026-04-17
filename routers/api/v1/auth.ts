import express, { Request, Response, Router, NextFunction } from 'express';
import { 
    AuthenticatedRequest, 
    CliRequest, 
    LoginData, 
    RegistrationData, 
    RateLimiterConfig 
} from '../../../types';
import type { LogManagerModule } from '../../../types/modules';
import AuthManagerImport from '../../../managers/AuthManager';
import RoleManagerImport from '../../../managers/RoleManager';
import PermissionManagerImport from '../../../managers/PermissionManager';
import ValidationManagerImport from '../../../managers/ValidationManager';
import databaseQueries from '../../../database/mainQueries';
import LogManagerImport from '../../../managers/LogManager';
import ValidationMiddlewareImport from '../../../managers/ValidationMiddleware';
import AuthAnalyticsImport from '../../../managers/AuthAnalytics';
import { RatelimitManager } from '../../../managers/RatelimitManager';
import SessionManagerImport from '../../../managers/SessionManager';
import AuthMonitorImport from '../../../managers/AuthMonitor';
import WebsocketManagerImport from '../../../managers/WebsocketManager';

const { userQueries } = databaseQueries;
const LogManager = LogManagerImport as unknown as LogManagerModule;
const AuthManager = AuthManagerImport as unknown as Record<string, any>;
const RoleManager = RoleManagerImport as unknown as Record<string, any>;
const PermissionManager = PermissionManagerImport as unknown as Record<string, any>;
const ValidationManager = ValidationManagerImport as unknown as Record<string, any>;
const ValidationMiddleware = ValidationMiddlewareImport as unknown as Record<string, any>;
const AuthAnalytics = AuthAnalyticsImport as unknown as Record<string, any>;
const SessionManager = SessionManagerImport as unknown as Record<string, any>;
const AuthMonitor = AuthMonitorImport as unknown as Record<string, any>;
const WebsocketManager = WebsocketManagerImport as unknown as Record<string, any>;

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
        const ip = req.ip;
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
        const ip = req.ip;
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
        const ip = req.ip;
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
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date()
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
            const validation = ValidationManager.validateRegistration(req.body);
            if (!validation.isValid) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.errors
                });
                return;
            }
            
            const foundUser = await userQueries.getUserByEmail(req.body.email);
            if (foundUser) {
                res.status(409).json({ error: 'Email already exists' });
                return;
            }
            
            const customRoles = (req as CliRequest).isCliRequest && req.body.roles ? req.body.roles : null;
            
            if (!(req as CliRequest).isCliRequest && req.body.roles) {
                LogManager.warning('Attempt to assign custom roles without valid CLI API key', {
                    ip: req.ip,
                    roles: req.body.roles
                });
            }
            
            const userData: RegistrationData = { ...req.body };
            if (userData.roles) delete userData.roles;
            
            const result = await AuthManager.register(userData);
            
            if (result.success) {
                if (customRoles && customRoles.length > 0) {
                    for (const roleName of customRoles) {
                        try {
                            const roleResult = await RoleManager.assignUserRole(result.user.id, roleName);
                            if (!roleResult.success) {
                                LogManager.warning(`Failed to assign role ${roleName} to user ${result.user.id}`, roleResult.error);
                            }
                        } catch (roleError) {
                            LogManager.error(`Error assigning role ${roleName}`, roleError);
                        }
                    }
                    
                    LogManager.info('Custom roles assigned via CLI', {
                        userId: result.user.id,
                        roles: customRoles,
                        ip: req.ip
                    });
                }
                
                AuthMonitor.trackRegistration(true, req.ip);
                AuthAnalytics.track('user_registered', {
                    userId: result.user.id,
                    ip: req.ip
                });
                
                WebsocketManager.notifyAuthEvent('user_registered', {
                    userId: result.user.id,
                    email: result.user.email
                });
                
                res.status(201).json({
                    message: 'User registered successfully',
                    token: result.token,
                    user: {
                        id: result.user.id,
                        email: result.user.email,
                        name: result.user.name,
                        email_verified: result.user.email_verified
                    }
                });
                return;
            } else {
                AuthMonitor.trackRegistration(false, req.ip);
                res.status(400).json({ error: result.message });
                return;
            }
        } catch (error) {
            LogManager.error('Registration error', error);
            AuthMonitor.trackRegistration(false, req.ip);
            res.status(500).json({ error: 'Registration failed' });
            return;
        }
    }
);

router.post('/login', 
    ValidationMiddleware.validateLogin, 
    loginLimiter, 
    trackAnalytics('login'),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password }: LoginData = req.body;
            
            const result = await AuthManager.login(email, password);
            
            if (result.success) {
                AuthMonitor.trackLoginAttempt(true, req.ip);
                
                const sessionResult = await SessionManager.createSession(result.user.id, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                });
                
                if (sessionResult.success) {
                    res.cookie('sessionId', sessionResult.sessionId, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
                    });
                }
                
                AuthAnalytics.track('user_login', {
                    userId: result.user.id,
                    ip: req.ip
                });
                
                WebsocketManager.notifyAuthEvent('user_login', {
                    userId: result.user.id,
                    email: result.user.email
                });
                
                res.json({
                    token: result.token,
                    user: result.user,
                    expiresIn: 24 * 60 * 60
                });
                return;
            } else {
                AuthMonitor.trackLoginAttempt(false, req.ip);
                res.status(401).json({ error: result.message });
                return;
            }
        } catch (error) {
            LogManager.error('Login error', error);
            AuthMonitor.trackLoginAttempt(false, req.ip);
            res.status(500).json({ error: 'Login failed' });
            return;
        }
    }
);

router.get('/me', AuthManager.getAuthMiddleware(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const userRoles = await RoleManager.getUserRoles(req.user.id);
        const userPermissions = await PermissionManager.getUserPermissions(req.user.id);
        
        res.json({
            user: req.user,
            roles: userRoles.success ? userRoles.roles : [],
            permissions: userPermissions.success ? userPermissions.permissions : []
        });
        return;
    } catch (error) {
        LogManager.error('Get user profile error', error);
        res.status(500).json({ error: 'Failed to get user profile' });
        return;
    }
});

router.get('/verify-email/:token', async (req: Request, res: Response): Promise<void> => {
    try {
        const { token } = req.params;
        
        if (!token) {
            res.status(400).json({ error: 'Token is required' });
            return;
        }
        
        const result = await AuthManager.verifyEmail(token);
        
        if (result.success) {
            WebsocketManager.notifyAuthEvent('email_verified', {
                userId: result.user.id,
                email: result.user.email
            });
            
            res.json({ message: 'Email verified successfully' });
            return;
        } else {
            res.status(400).json({ error: result.message });
            return;
        }
    } catch (error) {
        LogManager.error('Email verification error', error);
        res.status(500).json({ error: 'Email verification failed' });
        return;
    }
});

router.post('/forgot-password', 
    passwordResetLimiter, 
    trackAnalytics('forgot_password'),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const { email } = req.body;
            
            if (!email) {
                res.status(400).json({ error: 'Email is required' });
                return;
            }
            
            const result = await AuthManager.forgotPassword(email);
            res.json({ message: 'If the email exists, a password reset link has been sent' });
            
            if (result.success) {
                AuthAnalytics.track('password_reset_requested', {
                    email,
                    ip: req.ip
                });
            }
            return;
        } catch (error) {
            LogManager.error('Forgot password error', error);
            res.json({ message: 'If the email exists, a password reset link has been sent' });
            return;
        }
    }
);

router.post('/reset-password/:token', 
    passwordResetLimiter, 
    trackAnalytics('reset_password'),
    async (req: Request, res: Response): Promise<void> => {
        try {
            const { token } = req.params;
            const { password } = req.body;
            
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
            
            const result = await AuthManager.resetPassword(token, password);
            
            if (result.success) {
                AuthAnalytics.track('password_reset_completed', {
                    userId: result.user.id,
                    ip: req.ip
                });
                
                WebsocketManager.notifyAuthEvent('password_reset', {
                    userId: result.user.id,
                    email: result.user.email
                });
                
                res.json({ message: 'Password reset successfully' });
                return;
            } else {
                res.status(400).json({ error: result.message });
                return;
            }
        } catch (error) {
            LogManager.error('Reset password error', error);
            res.status(500).json({ error: 'Password reset failed' });
            return;
        }
    }
);
export = router;