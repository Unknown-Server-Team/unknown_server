const LogManager = require('./LogManager');
const CacheManager = require('./CacheManager');
const { AuthError } = require('./errors');

class AuthMonitor {
    constructor() {
        this.metrics = {
            loginAttempts: 0,
            successfulLogins: 0,
            failedLogins: 0,
            passwordResets: 0,
            emailVerifications: 0,
            roleChanges: 0,
            permissionChanges: 0,
            activeTokens: new Set(),
            suspiciousActivities: []
        };

        this.thresholds = {
            maxFailedAttempts: 5,
            suspiciousLoginWindow: 300000, // 5 minutes
            bruteForceWindow: 900000, // 15 minutes
            maxRoleChangesPerHour: 20
        };

        // Track failed login attempts by IP
        this.failedAttempts = new Map();
        // Track role changes by admin
        this.roleChangeHistory = new Map();
    }

    trackLoginAttempt(success, ip, userId = null) {
        this.metrics.loginAttempts++;
        if (success) {
            this.metrics.successfulLogins++;
            this.failedAttempts.delete(ip);
        } else {
            this.metrics.failedLogins++;
            this.trackFailedAttempt(ip);
        }

        // Track suspicious activities
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

    trackFailedAttempt(ip) {
        const attempts = this.failedAttempts.get(ip) || [];
        attempts.push(Date.now());
        
        // Keep only attempts within the brute force window
        const recentAttempts = attempts.filter(
            time => time > Date.now() - this.thresholds.bruteForceWindow
        );
        
        this.failedAttempts.set(ip, recentAttempts);

        if (recentAttempts.length >= this.thresholds.maxFailedAttempts) {
            this.handleBruteForceAttempt(ip);
        }
    }

    handleBruteForceAttempt(ip) {
        LogManager.warning('Potential brute force attack detected', {
            ip,
            attempts: this.failedAttempts.get(ip).length
        });

        this.recordSuspiciousActivity({
            type: 'brute_force',
            ip,
            timestamp: Date.now(),
            attemptCount: this.failedAttempts.get(ip).length
        });
    }

    trackTokenUsage(token) {
        this.metrics.activeTokens.add(token);
    }

    removeToken(token) {
        this.metrics.activeTokens.delete(token);
    }

    trackRoleChange(adminId, targetUserId, roleChanges) {
        this.metrics.roleChanges++;
        
        const adminHistory = this.roleChangeHistory.get(adminId) || [];
        adminHistory.push({
            timestamp: Date.now(),
            targetUserId,
            changes: roleChanges
        });

        // Keep only last hour's changes
        const recentChanges = adminHistory.filter(
            change => change.timestamp > Date.now() - 3600000
        );
        this.roleChangeHistory.set(adminId, recentChanges);

        if (recentChanges.length > this.thresholds.maxRoleChangesPerHour) {
            this.handleExcessiveRoleChanges(adminId);
        }
    }

    handleExcessiveRoleChanges(adminId) {
        LogManager.warning('Excessive role changes detected', {
            adminId,
            changeCount: this.roleChangeHistory.get(adminId).length
        });

        this.recordSuspiciousActivity({
            type: 'excessive_role_changes',
            adminId,
            timestamp: Date.now(),
            changeCount: this.roleChangeHistory.get(adminId).length
        });
    }

    trackPermissionChange(roleId, changes) {
        this.metrics.permissionChanges++;
    }

    isActivitySuspicious(ip, userId = null) {
        const recentAttempts = this.failedAttempts.get(ip) || [];
        const recentFailures = recentAttempts.filter(
            time => time > Date.now() - this.thresholds.suspiciousLoginWindow
        ).length;

        return recentFailures >= Math.floor(this.thresholds.maxFailedAttempts / 2);
    }

    recordSuspiciousActivity(activity) {
        this.metrics.suspiciousActivities.push(activity);
        LogManager.warning('Suspicious activity detected', activity);

        // Keep only last 100 suspicious activities
        if (this.metrics.suspiciousActivities.length > 100) {
            this.metrics.suspiciousActivities.shift();
        }
    }

    getMetrics() {
        return {
            ...this.metrics,
            activeTokenCount: this.metrics.activeTokens.size,
            failureRate: this.metrics.loginAttempts ? 
                (this.metrics.failedLogins / this.metrics.loginAttempts) * 100 : 0,
            suspiciousActivityCount: this.metrics.suspiciousActivities.length,
            recentSuspiciousActivities: this.metrics.suspiciousActivities.slice(-10)
        };
    }

    async cacheMetrics() {
        await CacheManager.set('auth:metrics', this.getMetrics(), 300); // Cache for 5 minutes
    }

    clearOldData() {
        const now = Date.now();
        
        // Clear old failed attempts
        for (const [ip, attempts] of this.failedAttempts.entries()) {
            const recentAttempts = attempts.filter(
                time => time > now - this.thresholds.bruteForceWindow
            );
            if (recentAttempts.length === 0) {
                this.failedAttempts.delete(ip);
            } else {
                this.failedAttempts.set(ip, recentAttempts);
            }
        }

        // Clear old role change history
        for (const [adminId, changes] of this.roleChangeHistory.entries()) {
            const recentChanges = changes.filter(
                change => change.timestamp > now - 3600000
            );
            if (recentChanges.length === 0) {
                this.roleChangeHistory.delete(adminId);
            } else {
                this.roleChangeHistory.set(adminId, recentChanges);
            }
        }
    }

    startMonitoring() {
        // Cache metrics every 5 minutes
        setInterval(() => this.cacheMetrics(), 300000);
        
        // Clear old data every hour
        setInterval(() => this.clearOldData(), 3600000);
    }
}

module.exports = new AuthMonitor();