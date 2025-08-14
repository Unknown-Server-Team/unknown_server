import express, { Request, Response, Router, NextFunction } from 'express';
import { 
    AuthenticatedRequest, 
    CliRequest, 
    UserData, 
    LoginData, 
    RegistrationData, 
    RoleData,
    RateLimiterConfig 
} from '../../../types';

// Import managers (keeping require for now as they haven't been converted yet)
const AuthManager = require('../../../managers/AuthManager');
const RoleManager = require('../../../managers/RoleManager');
const PermissionManager = require('../../../managers/PermissionManager');
const ValidationManager = require('../../../managers/ValidationManager');
const { userQueries } = require('../../../database/mainQueries');
const LogManager = require('../../../managers/LogManager');
const ValidationMiddleware = require('../../../managers/ValidationMiddleware');
const AuthAnalytics = require('../../../managers/AuthAnalytics');
const { RatelimitManager } = require('../../../managers/RatelimitManager');
const SessionManager = require('../../../managers/SessionManager');
const AuthMonitor = require('../../../managers/AuthMonitor');
const { query } = require('../../../database/db');
const WebsocketManager = require('../../../managers/WebsocketManager');

const router: Router = express.Router();

// CLI API key validation middleware
const validateCliApiKey = (req: Request, res: Response, next: NextFunction) => {
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

// Define enhanced rate limiters with new features
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

// Analytics middleware
const trackAnalytics = (action: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // Track after response
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

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register a new user
 *     description: Register a new user account with email verification
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
 *                 minLength: 8
 *               name:
 *                 type: string
 *                 minLength: 2
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Only available with valid CLI API key
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 *       500:
 *         description: Server error
 */
router.post('/register',
    ValidationMiddleware.validateRegistration,
    registrationLimiter,
    validateCliApiKey,
    trackAnalytics('register'),
    async (req: Request, res: Response) => {
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
            
            // Extract roles from request if CLI API key is valid
            const customRoles = (req as CliRequest).isCliRequest && req.body.roles ? req.body.roles : null;
            
            // Log attempt to assign custom roles without CLI API key
            if (!(req as CliRequest).isCliRequest && req.body.roles) {
                LogManager.warning('Attempt to assign custom roles without valid CLI API key', {
                    ip: req.ip,
                    roles: req.body.roles
                });
            }
            
            // Create user data object
            const userData: RegistrationData = { ...req.body };
            if (userData.roles) delete userData.roles;
            
            const result = await AuthManager.register(userData);
            
            if (result.success) {
                // Assign custom roles if CLI request and roles specified
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
                
                // Track registration success
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
            } else {
                AuthMonitor.trackRegistration(false, req.ip);
                res.status(400).json({ error: result.message });
            }
        } catch (error) {
            LogManager.error('Registration error', error);
            AuthMonitor.trackRegistration(false, req.ip);
            res.status(500).json({ error: 'Registration failed' });
        }
    }
);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Login user
 *     description: Authenticate user and return JWT token
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
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post('/login', 
    ValidationMiddleware.validateLogin, 
    loginLimiter, 
    trackAnalytics('login'),
    async (req: Request, res: Response) => {
        try {
            const { email, password }: LoginData = req.body;
            
            const result = await AuthManager.login(email, password);
            
            if (result.success) {
                AuthMonitor.trackLoginAttempt(true, req.ip);
                
                // Create session
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
                    expiresIn: 24 * 60 * 60 // 24 hours in seconds
                });
            } else {
                AuthMonitor.trackLoginAttempt(false, req.ip);
                res.status(401).json({ error: result.message });
            }
        } catch (error) {
            LogManager.error('Login error', error);
            AuthMonitor.trackLoginAttempt(false, req.ip);
            res.status(500).json({ error: 'Login failed' });
        }
    }
);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get current user
 *     description: Get current authenticated user information
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *       401:
 *         description: Not authenticated
 */
router.get('/me', AuthManager.getAuthMiddleware(), async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Get user roles
        const userRoles = await RoleManager.getUserRoles(req.user.id);
        const userPermissions = await PermissionManager.getUserPermissions(req.user.id);
        
        res.json({
            user: req.user,
            roles: userRoles.success ? userRoles.roles : [],
            permissions: userPermissions.success ? userPermissions.permissions : []
        });
    } catch (error) {
        LogManager.error('Get user profile error', error);
        res.status(500).json({ error: 'Failed to get user profile' });
    }
});

/**
 * @swagger
 * /api/v1/auth/verify-email/{token}:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Verify email address
 *     description: Verify user email address using verification token
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
router.get('/verify-email/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        
        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }
        
        const result = await AuthManager.verifyEmail(token);
        
        if (result.success) {
            WebsocketManager.notifyAuthEvent('email_verified', {
                userId: result.user.id,
                email: result.user.email
            });
            
            res.json({ message: 'Email verified successfully' });
        } else {
            res.status(400).json({ error: result.message });
        }
    } catch (error) {
        LogManager.error('Email verification error', error);
        res.status(500).json({ error: 'Email verification failed' });
    }
});

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request password reset
 *     description: Send password reset email to user
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
 *                 format: email
 *     responses:
 *       200:
 *         description: Password reset email sent
 *       400:
 *         description: Invalid email
 */
router.post('/forgot-password', 
    passwordResetLimiter, 
    trackAnalytics('forgot_password'),
    async (req: Request, res: Response) => {
        try {
            const { email } = req.body;
            
            if (!email) {
                return res.status(400).json({ error: 'Email is required' });
            }
            
            const result = await AuthManager.forgotPassword(email);
            
            // Always return success to prevent email enumeration
            res.json({ message: 'If the email exists, a password reset link has been sent' });
            
            if (result.success) {
                AuthAnalytics.track('password_reset_requested', {
                    email,
                    ip: req.ip
                });
            }
        } catch (error) {
            LogManager.error('Forgot password error', error);
            res.json({ message: 'If the email exists, a password reset link has been sent' });
        }
    }
);

/**
 * @swagger
 * /api/v1/auth/reset-password/{token}:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Reset password
 *     description: Reset user password using reset token
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
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid token or password
 */
router.post('/reset-password/:token', 
    passwordResetLimiter, 
    trackAnalytics('reset_password'),
    async (req: Request, res: Response) => {
        try {
            const { token } = req.params;
            const { password } = req.body;
            
            if (!token || !password) {
                return res.status(400).json({ error: 'Token and password are required' });
            }
            
            const passwordValidation = ValidationManager.validatePassword(password);
            if (!passwordValidation.isValid) {
                return res.status(400).json({
                    error: 'Password validation failed',
                    details: passwordValidation.errors
                });
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
            } else {
                res.status(400).json({ error: result.message });
            }
        } catch (error) {
            LogManager.error('Reset password error', error);
            res.status(500).json({ error: 'Password reset failed' });
        }
    }
);

// Export router
export = router;