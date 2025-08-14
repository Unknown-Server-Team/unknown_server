import { v4 as uuidv4 } from 'uuid';
import { CacheManager } from './CacheManager';
import { LogManager } from './LogManager';
import { AuthError } from './errors';
import { Request, Response, NextFunction } from 'express';

interface SessionData {
    id: string;
    userId: number;
    metadata: any;
    createdAt: number;
    lastActivity: number;
}

interface AuthenticatedRequest extends Request {
    session?: SessionData;
}

class SessionManager {
    private sessionPrefix: string;
    private defaultSessionDuration: number;
    private cleanupInterval: number;

    constructor() {
        this.sessionPrefix = 'session:';
        this.defaultSessionDuration = 24 * 60 * 60; // 24 hours in seconds
        this.cleanupInterval = 60 * 60; // Cleanup every hour
        this.startCleanup();
    }

    async createSession(userId: number, metadata: any = {}): Promise<string> {
        const sessionId = uuidv4();
        const session: SessionData = {
            id: sessionId,
            userId,
            metadata,
            createdAt: Date.now(),
            lastActivity: Date.now()
        };

        await CacheManager.set(
            `${this.sessionPrefix}${sessionId}`,
            session,
            this.defaultSessionDuration
        );

        // Track session for user
        const userSessions = await this.getUserSessions(userId);
        userSessions.push(sessionId);
        await CacheManager.set(
            `${this.sessionPrefix}user:${userId}`,
            userSessions,
            this.defaultSessionDuration
        );

        return sessionId;
    }

    async getSession(sessionId: string): Promise<SessionData> {
        const session = await CacheManager.get(`${this.sessionPrefix}${sessionId}`);
        if (!session) {
            throw new AuthError('Session not found', 'SESSION_NOT_FOUND');
        }
        return session;
    }

    async updateSession(sessionId: string, updates: Partial<SessionData>): Promise<SessionData> {
        const session = await this.getSession(sessionId);
        const updatedSession: SessionData = {
            ...session,
            ...updates,
            lastActivity: Date.now()
        };

        await CacheManager.set(
            `${this.sessionPrefix}${sessionId}`,
            updatedSession,
            this.defaultSessionDuration
        );

        return updatedSession;
    }

    async getUserSessions(userId: number): Promise<string[]> {
        const sessions = await CacheManager.get(`${this.sessionPrefix}user:${userId}`) || [];
        return sessions;
    }

    async invalidateSession(sessionId: string): Promise<void> {
        const session = await this.getSession(sessionId);
        await CacheManager.del(`${this.sessionPrefix}${sessionId}`);

        // Remove from user sessions
        const userSessions = await this.getUserSessions(session.userId);
        const updatedSessions = userSessions.filter(id => id !== sessionId);
        await CacheManager.set(
            `${this.sessionPrefix}user:${session.userId}`,
            updatedSessions,
            this.defaultSessionDuration
        );

        LogManager.info('Session invalidated', { sessionId, userId: session.userId });
    }

    async invalidateUserSessions(userId: number): Promise<void> {
        const sessions = await this.getUserSessions(userId);
        for (const sessionId of sessions) {
            await CacheManager.del(`${this.sessionPrefix}${sessionId}`);
        }
        await CacheManager.del(`${this.sessionPrefix}user:${userId}`);

        LogManager.info('All user sessions invalidated', { 
            userId, 
            sessionCount: sessions.length 
        });
    }

    createSessionMiddleware() {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            const sessionId = req.headers['x-session-id'] as string;
            if (!sessionId) {
                return next();
            }

            try {
                const session = await this.getSession(sessionId);
                req.session = session;
                // Update last activity
                await this.updateSession(sessionId, {});
                next();
            } catch (error: any) {
                if (error instanceof AuthError && error.code === 'SESSION_NOT_FOUND') {
                    // Clear invalid session header
                    res.setHeader('X-Session-Id', '');
                    next();
                } else {
                    next(error);
                }
            }
        };
    }

    private startCleanup(): void {
        setInterval(async () => {
            try {
                const pattern = `${this.sessionPrefix}*`;
                const keys = await CacheManager.keys(pattern);
                const now = Date.now();

                for (const key of keys) {
                    const session = await CacheManager.get(key);
                    if (session && now - session.lastActivity > this.defaultSessionDuration * 1000) {
                        await CacheManager.del(key);
                        LogManager.debug('Cleaned up expired session', { sessionId: session.id });
                    }
                }
            } catch (error) {
                LogManager.error('Session cleanup error', error);
            }
        }, this.cleanupInterval * 1000);
    }
}

export const sessionManager = new SessionManager();
export default sessionManager;