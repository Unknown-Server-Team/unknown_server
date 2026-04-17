import type {
    SessionInfo,
    SessionSuspiciousActivity,
    SessionThresholds,
    SessionStats,
    AdminNotification
} from '../types/session';
import type { CacheManagerModule, LogManagerModule } from '../types/modules';

const LogManager = require('./LogManager') as LogManagerModule;
const CacheManager = require('./CacheManager') as CacheManagerModule;

class SessionMonitor {
    private activeSessions: Map<number, Map<string, SessionInfo>>;
    private suspiciousActivities: SessionSuspiciousActivity[];
    private thresholds: SessionThresholds;

    constructor() {
        this.activeSessions = new Map();
        this.suspiciousActivities = [];
        this.thresholds = {
            maxSessionsPerUser: 5,
            maxConcurrentLogins: 3,
            sessionInactivityTimeout: 30 * 60 * 1000,
            suspiciousActivityThreshold: 3
        };

        this.startMonitoring();
    }

    trackSession(userId: number, sessionId: string, metadata: unknown = {}): void {
        const userSessions = this.activeSessions.get(userId) || new Map<string, SessionInfo>();

        if (userSessions.size >= this.thresholds.maxConcurrentLogins) {
            this.recordSuspiciousActivity({
                type: 'concurrent_sessions',
                userId,
                sessionCount: userSessions.size + 1,
                timestamp: Date.now()
            });
        }

        userSessions.set(sessionId, {
            createdAt: Date.now(),
            lastActivity: Date.now(),
            metadata
        });

        this.activeSessions.set(userId, userSessions);
    }

    updateSessionActivity(userId: number, sessionId: string): void {
        const userSessions = this.activeSessions.get(userId);
        if (userSessions && userSessions.has(sessionId)) {
            userSessions.get(sessionId)!.lastActivity = Date.now();
        }
    }

    removeSession(userId: number, sessionId: string): void {
        const userSessions = this.activeSessions.get(userId);
        if (userSessions) {
            userSessions.delete(sessionId);
            if (userSessions.size === 0) {
                this.activeSessions.delete(userId);
            }
        }
    }

    getActiveSessions(userId: number): SessionInfo[] {
        return Array.from(this.activeSessions.get(userId)?.values() || []);
    }

    getAllActiveSessions(): Map<number, Array<[string, SessionInfo]>> {
        const sessions = new Map<number, Array<[string, SessionInfo]>>();
        for (const [userId, userSessions] of this.activeSessions) {
            sessions.set(userId, Array.from(userSessions.entries()));
        }
        return sessions;
    }

    private recordSuspiciousActivity(activity: SessionSuspiciousActivity): void {
        this.suspiciousActivities.push(activity);
        LogManager.warning('Suspicious session activity detected', activity as unknown as Record<string, unknown>);

        if (this.suspiciousActivities.length > 100) {
            this.suspiciousActivities.shift();
        }

        const recentUserActivities = this.suspiciousActivities.filter(
            a => a.userId === activity.userId &&
            a.timestamp > Date.now() - 24 * 60 * 60 * 1000
        );

        if (recentUserActivities.length >= this.thresholds.suspiciousActivityThreshold) {
            void this.handleSuspiciousUser(activity.userId);
        }
    }

    private async handleSuspiciousUser(userId: number): Promise<void> {
        LogManager.error('Multiple suspicious activities detected for user', { userId } as unknown as Error);

        const userSessions = this.activeSessions.get(userId);
        if (userSessions) {
            for (const sessionId of userSessions.keys()) {
                await CacheManager.del(`session:${sessionId}`);
                this.removeSession(userId, sessionId);
            }
        }

        this.notifyAdmin({
            type: 'suspicious_user',
            userId,
            activities: this.suspiciousActivities
                .filter(a => a.userId === userId)
                .slice(-5)
        });
    }

    private notifyAdmin(data: AdminNotification): void {
        LogManager.error('Security alert', data as unknown as Error);
    }

    private startMonitoring(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [userId, userSessions] of this.activeSessions) {
                for (const [sessionId, session] of userSessions) {
                    if (now - session.lastActivity > this.thresholds.sessionInactivityTimeout) {
                        this.removeSession(userId, sessionId);
                        LogManager.info('Removed inactive session', { userId, sessionId });
                    }
                }
            }
        }, 60000);

        setInterval(() => {
            const stats = this.getSessionStats();
            LogManager.info('Session statistics', stats as unknown as Record<string, unknown>);
        }, 300000);
    }

    getSessionStats(): SessionStats {
        let totalSessions = 0;
        const userCounts = new Map<number, number>();
        const now = Date.now();
        const activeInLast = {
            '5m': 0,
            '15m': 0,
            '1h': 0
        };

        for (const [userId, userSessions] of this.activeSessions) {
            userCounts.set(userId, userSessions.size);
            totalSessions += userSessions.size;

            for (const session of userSessions.values()) {
                const timeSinceActivity = now - session.lastActivity;
                if (timeSinceActivity <= 5 * 60 * 1000) activeInLast['5m']++;
                if (timeSinceActivity <= 15 * 60 * 1000) activeInLast['15m']++;
                if (timeSinceActivity <= 60 * 60 * 1000) activeInLast['1h']++;
            }
        }

        return {
            totalSessions,
            uniqueUsers: this.activeSessions.size,
            activeInLast,
            avgSessionsPerUser: totalSessions / (this.activeSessions.size || 1),
            suspiciousActivities: this.suspiciousActivities.length
        };
    }
}

const sessionMonitor = new SessionMonitor();

module.exports = sessionMonitor;
module.exports.SessionMonitor = SessionMonitor;
