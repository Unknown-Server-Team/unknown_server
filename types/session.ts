import type { Request } from 'express';

export interface SessionData {
    id: string;
    userId: number;
    metadata: unknown;
    createdAt: number;
    lastActivity: number;
}

export interface SessionRequest extends Request {
    session?: SessionData;
}

export interface SessionInfo {
    createdAt: number;
    lastActivity: number;
    metadata: unknown;
}

export interface SessionSuspiciousActivity {
    type: string;
    userId: number;
    sessionCount?: number;
    timestamp: number;
}

export interface SessionThresholds {
    maxSessionsPerUser: number;
    maxConcurrentLogins: number;
    sessionInactivityTimeout: number;
    suspiciousActivityThreshold: number;
}

export interface SessionStats {
    totalSessions: number;
    uniqueUsers: number;
    activeInLast: {
        '5m': number;
        '15m': number;
        '1h': number;
    };
    avgSessionsPerUser: number;
    suspiciousActivities: number;
}

export interface AdminNotification {
    type: string;
    userId: number;
    activities: SessionSuspiciousActivity[];
}
