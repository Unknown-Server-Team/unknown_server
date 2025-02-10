const LogManager = require('./LogManager');
const CacheManager = require('./CacheManager');
const { AuthError } = require('./errors');

class SessionMonitor {
    constructor() {
        this.activeSessions = new Map();
        this.suspiciousActivities = [];
        this.thresholds = {
            maxSessionsPerUser: 5,
            maxConcurrentLogins: 3,
            sessionInactivityTimeout: 30 * 60 * 1000, // 30 minutes
            suspiciousActivityThreshold: 3
        };

        this.startMonitoring();
    }

    trackSession(userId, sessionId, metadata = {}) {
        const userSessions = this.activeSessions.get(userId) || new Map();
        
        // Check for suspicious concurrent sessions
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

    updateSessionActivity(userId, sessionId) {
        const userSessions = this.activeSessions.get(userId);
        if (userSessions && userSessions.has(sessionId)) {
            userSessions.get(sessionId).lastActivity = Date.now();
        }
    }

    removeSession(userId, sessionId) {
        const userSessions = this.activeSessions.get(userId);
        if (userSessions) {
            userSessions.delete(sessionId);
            if (userSessions.size === 0) {
                this.activeSessions.delete(userId);
            }
        }
    }

    getActiveSessions(userId) {
        return Array.from(this.activeSessions.get(userId)?.values() || []);
    }

    getAllActiveSessions() {
        const sessions = new Map();
        for (const [userId, userSessions] of this.activeSessions) {
            sessions.set(userId, Array.from(userSessions.entries()));
        }
        return sessions;
    }

    recordSuspiciousActivity(activity) {
        this.suspiciousActivities.push(activity);
        LogManager.warning('Suspicious session activity detected', activity);

        // Keep only last 100 activities
        if (this.suspiciousActivities.length > 100) {
            this.suspiciousActivities.shift();
        }

        // Check if user has reached suspicious activity threshold
        const recentUserActivities = this.suspiciousActivities.filter(
            a => a.userId === activity.userId && 
            a.timestamp > Date.now() - 24 * 60 * 60 * 1000 // Last 24 hours
        );

        if (recentUserActivities.length >= this.thresholds.suspiciousActivityThreshold) {
            this.handleSuspiciousUser(activity.userId);
        }
    }

    async handleSuspiciousUser(userId) {
        LogManager.error('Multiple suspicious activities detected for user', { userId });
        
        // Get all user sessions
        const userSessions = this.activeSessions.get(userId);
        if (userSessions) {
            // Invalidate all sessions
            for (const sessionId of userSessions.keys()) {
                await CacheManager.del(`session:${sessionId}`);
                this.removeSession(userId, sessionId);
            }
        }

        // Notify admin (you would implement this based on your notification system)
        this.notifyAdmin({
            type: 'suspicious_user',
            userId,
            activities: this.suspiciousActivities
                .filter(a => a.userId === userId)
                .slice(-5) // Last 5 activities
        });
    }

    notifyAdmin(data) {
        // Implementation would depend on your notification system
        LogManager.error('Security alert', data);
    }

    startMonitoring() {
        // Check for inactive sessions every minute
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

        // Log session statistics every 5 minutes
        setInterval(() => {
            const stats = this.getSessionStats();
            LogManager.info('Session statistics', stats);
        }, 300000);
    }

    getSessionStats() {
        let totalSessions = 0;
        const userCounts = new Map();
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

module.exports = new SessionMonitor();