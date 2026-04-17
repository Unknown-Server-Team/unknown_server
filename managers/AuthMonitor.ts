import type {
    SuspiciousActivity,
    AuthMetrics,
    AuthThresholds,
    RoleChangeEntry,
    AuthMetricsSnapshot
} from '../types/authMonitor';
import type { CacheManagerModule } from '../types/modules';
import LogManager from './LogManager';
import CacheManagerImport from './CacheManager';

const CacheManager = CacheManagerImport as unknown as CacheManagerModule;

class AuthMonitor {
    private metrics: AuthMetrics;
    private thresholds: AuthThresholds;
    private failedAttempts: Map<string, number[]>;
    private roleChangeHistory: Map<number, RoleChangeEntry[]>;

    constructor() {
        this.metrics = {
            loginAttempts: 0,
            successfulLogins: 0,
            failedLogins: 0,
            passwordResets: 0,
            emailVerifications: 0,
            roleChanges: 0,
            permissionChanges: 0,
            activeTokens: new Set<string>(),
            suspiciousActivities: []
        };
        this.thresholds = {
            maxFailedAttempts: 5,
            suspiciousLoginWindow: 300000,
            bruteForceWindow: 900000,
            maxRoleChangesPerHour: 20
        };
        this.failedAttempts = new Map<string, number[]>();
        this.roleChangeHistory = new Map<number, RoleChangeEntry[]>();
    }

    trackLoginAttempt(success: boolean, ip: string, userId: number | null = null): void {
        this.metrics.loginAttempts++;
        if (success) {
            this.metrics.successfulLogins++;
            this.failedAttempts.delete(ip);
        } else {
            this.metrics.failedLogins++;
            this.trackFailedAttempt(ip);
        }

        if (this.isActivitySuspicious(ip, userId)) {
            this.recordSuspiciousActivity({
                type: 'login_attempt',
                ip,
                userId,
                timestamp: Date.now(),
                success
            });
        }
    }

    trackFailedAttempt(ip: string): void {
        const attempts = this.failedAttempts.get(ip) || [];
        attempts.push(Date.now());
        const recentAttempts = attempts.filter((time: number): boolean => time > Date.now() - this.thresholds.bruteForceWindow);
        this.failedAttempts.set(ip, recentAttempts);

        if (recentAttempts.length >= this.thresholds.maxFailedAttempts) {
            this.handleBruteForceAttempt(ip);
        }
    }

    handleBruteForceAttempt(ip: string): void {
        const attempts = this.failedAttempts.get(ip) || [];
        LogManager.warning('Potential brute force attack detected', {
            ip,
            attempts: attempts.length
        });

        this.recordSuspiciousActivity({
            type: 'brute_force',
            ip,
            timestamp: Date.now(),
            attemptCount: attempts.length
        });
    }

    trackTokenUsage(token: string): void {
        this.metrics.activeTokens.add(token);
    }

    removeToken(token: string): void {
        this.metrics.activeTokens.delete(token);
    }

    trackRoleChange(adminId: number, targetUserId: number, roleChanges: string[]): void {
        this.metrics.roleChanges++;
        const adminHistory = this.roleChangeHistory.get(adminId) || [];
        adminHistory.push({
            timestamp: Date.now(),
            targetUserId,
            changes: roleChanges
        });

        const recentChanges = adminHistory.filter((change: RoleChangeEntry): boolean => change.timestamp > Date.now() - 3600000);
        this.roleChangeHistory.set(adminId, recentChanges);

        if (recentChanges.length > this.thresholds.maxRoleChangesPerHour) {
            this.handleExcessiveRoleChanges(adminId);
        }
    }

    handleExcessiveRoleChanges(adminId: number): void {
        const changes = this.roleChangeHistory.get(adminId) || [];
        LogManager.warning('Excessive role changes detected', {
            adminId,
            changeCount: changes.length
        });

        this.recordSuspiciousActivity({
            type: 'excessive_role_changes',
            adminId,
            timestamp: Date.now(),
            changeCount: changes.length
        });
    }

    trackPermissionChange(_roleId: number, _changes: string[]): void {
        this.metrics.permissionChanges++;
    }

    isActivitySuspicious(ip: string, _userId: number | null = null): boolean {
        const recentAttempts = this.failedAttempts.get(ip) || [];
        const recentFailures = recentAttempts.filter(
            (time: number): boolean => time > Date.now() - this.thresholds.suspiciousLoginWindow
        ).length;

        return recentFailures >= Math.floor(this.thresholds.maxFailedAttempts / 2);
    }

    recordSuspiciousActivity(activity: SuspiciousActivity): void {
        this.metrics.suspiciousActivities.push(activity);
        LogManager.warning('Suspicious activity detected', { activity: activity as unknown });

        if (this.metrics.suspiciousActivities.length > 100) {
            this.metrics.suspiciousActivities.shift();
        }
    }

    getMetrics(): AuthMetricsSnapshot {
        return {
            ...this.metrics,
            activeTokenCount: this.metrics.activeTokens.size,
            failureRate: this.metrics.loginAttempts ? (this.metrics.failedLogins / this.metrics.loginAttempts) * 100 : 0,
            suspiciousActivityCount: this.metrics.suspiciousActivities.length,
            recentSuspiciousActivities: this.metrics.suspiciousActivities.slice(-10)
        };
    }

    async cacheMetrics(): Promise<void> {
        await CacheManager.set('auth:metrics', this.getMetrics(), 300);
    }

    clearOldData(): void {
        const now = Date.now();

        for (const [ip, attempts] of this.failedAttempts.entries()) {
            const recentAttempts = attempts.filter((time: number): boolean => time > now - this.thresholds.bruteForceWindow);
            if (recentAttempts.length === 0) {
                this.failedAttempts.delete(ip);
            } else {
                this.failedAttempts.set(ip, recentAttempts);
            }
        }

        for (const [adminId, changes] of this.roleChangeHistory.entries()) {
            const recentChanges = changes.filter((change: RoleChangeEntry): boolean => change.timestamp > now - 3600000);
            if (recentChanges.length === 0) {
                this.roleChangeHistory.delete(adminId);
            } else {
                this.roleChangeHistory.set(adminId, recentChanges);
            }
        }
    }

    startMonitoring(): void {
        setInterval((): void => {
            void this.cacheMetrics();
        }, 300000);
        setInterval((): void => this.clearOldData(), 3600000);
    }
}

const authMonitor = new AuthMonitor();

export = authMonitor;
