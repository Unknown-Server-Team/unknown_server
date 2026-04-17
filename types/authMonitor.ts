export interface SuspiciousActivity {
    type: string;
    ip?: string;
    userId?: number | null;
    timestamp: number;
    success?: boolean;
    attemptCount?: number;
    adminId?: number;
    changeCount?: number;
}

export interface AuthMetrics {
    loginAttempts: number;
    successfulLogins: number;
    failedLogins: number;
    passwordResets: number;
    emailVerifications: number;
    roleChanges: number;
    permissionChanges: number;
    activeTokens: Set<string>;
    suspiciousActivities: SuspiciousActivity[];
}

export interface AuthThresholds {
    maxFailedAttempts: number;
    suspiciousLoginWindow: number;
    bruteForceWindow: number;
    maxRoleChangesPerHour: number;
}

export interface RoleChangeEntry {
    timestamp: number;
    targetUserId: number;
    changes: string[];
}

export interface AuthMetricsSnapshot extends AuthMetrics {
    activeTokenCount: number;
    failureRate: number;
    suspiciousActivityCount: number;
    recentSuspiciousActivities: SuspiciousActivity[];
}
