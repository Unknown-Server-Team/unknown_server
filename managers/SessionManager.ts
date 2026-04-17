import { v4 as uuidv4 } from 'uuid';
import type { Response, NextFunction } from 'express';
import { AuthError } from './errors';
import type { SessionData, SessionRequest } from '../types/session';
import type { CacheManagerModule, LogManagerModule } from '../types/modules';

const CacheManager = require('./CacheManager') as CacheManagerModule;
const LogManager = require('./LogManager') as LogManagerModule;

class SessionManager {
    private sessionPrefix: string;
    private defaultSessionDuration: number;
    private cleanupInterval: number;

    constructor() {
        this.sessionPrefix = 'session:';
        this.defaultSessionDuration = 24 * 60 * 60;
        this.cleanupInterval = 60 * 60;
        this.startCleanup();
    }

    async createSession(userId: number, metadata: unknown = {}): Promise<string> {
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
        const session = await CacheManager.get<SessionData>(`${this.sessionPrefix}${sessionId}`);
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
        const sessions = await CacheManager.get<string[]>(`${this.sessionPrefix}user:${userId}`);
        return sessions || [];
    }

    async invalidateSession(sessionId: string): Promise<void> {
        const session = await this.getSession(sessionId);
        await CacheManager.del(`${this.sessionPrefix}${sessionId}`);

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

    createSessionMiddleware(): (req: SessionRequest, res: Response, next: NextFunction) => Promise<void> {
        return async (req: SessionRequest, res: Response, next: NextFunction): Promise<void> => {
            const sessionId = req.headers['x-session-id'] as string;
            if (!sessionId) {
                return next();
            }

            try {
                const session = await this.getSession(sessionId);
                req.session = session;
                await this.updateSession(sessionId, {});
                next();
            } catch (error: unknown) {
                if (error instanceof AuthError && error.code === 'SESSION_NOT_FOUND') {
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
                const keys = CacheManager.keys(pattern);
                const now = Date.now();

                for (const key of keys) {
                    const session = await CacheManager.get<SessionData>(key);
                    if (session && now - session.lastActivity > this.defaultSessionDuration * 1000) {
                        await CacheManager.del(key);
                        LogManager.debug('Cleaned up expired session', { sessionId: session.id });
                    }
                }
            } catch (error: unknown) {
                LogManager.error('Session cleanup error', error);
            }
        }, this.cleanupInterval * 1000);
    }
}

const sessionManager = new SessionManager();

module.exports = sessionManager;
module.exports.SessionManager = SessionManager;
