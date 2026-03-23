const LogManager = require('./LogManager');
const os = require('os');

class PerformanceManager {
    constructor() {
        this.startTime = process.hrtime();
        this.metrics = {
            requests: 0,
            errors: 0,
            avgResponseTime: 0,
            totalResponseTime: 0,
            statusCodes: {},
            endpoints: {},
            maxMemoryUsage: 0,
            cpuUsage: [],
            slowestEndpoints: new Map(),
            requestsPerMinute: [],
            historyRetentionHours: 24,
            responseTimeHistory: [],
            alerts: new Map()
        };

        this.thresholds = {
            memoryWarning: 0.85,
            slowResponseTime: 1000,
            highCpuUsage: 0.8,
            requestRateWarning: 1000,
            errorRateWarning: 0.1,
            alertCooldown: 300000
        };

        this.startMonitoring();
        this.startMetricsCleaning();
    }

    startMonitoring() {
        setInterval(() => this.monitorResources(), 30000);
        setInterval(() => this.trackRequestRate(), 60000);
    }

    startMetricsCleaning() {
        setInterval(() => this.cleanOldMetrics(), 3600000);
    }

    cleanOldMetrics() {
        const now = Date.now();
        const retentionTime = this.metrics.historyRetentionHours * 3600000;

        this.metrics.responseTimeHistory = this.metrics.responseTimeHistory.filter(
            item => (now - item.timestamp) < retentionTime
        );

        if (this.metrics.cpuUsage.length > 120) {
            this.metrics.cpuUsage = this.metrics.cpuUsage.slice(-120);
        }

        this.metrics.requestsPerMinute = this.metrics.requestsPerMinute.filter(
            item => (now - item.timestamp) < retentionTime
        );

        for (const [key, timestamp] of this.metrics.alerts) {
            if (now - timestamp > retentionTime) {
                this.metrics.alerts.delete(key);
            }
        }

        if (Object.keys(this.metrics.endpoints).length > 1000) {
            const sortedEndpoints = Object.entries(this.metrics.endpoints)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 1000);
            this.metrics.endpoints = Object.fromEntries(sortedEndpoints);
        }
    }

    monitorResources() {
        const used = process.memoryUsage();
        const memoryUsage = used.heapUsed / used.heapTotal;
        this.metrics.maxMemoryUsage = Math.max(this.metrics.maxMemoryUsage, memoryUsage);

        const cpus = os.cpus();
        const cpuUsage = {
            timestamp: Date.now(),
            average: os.loadavg()[0] / cpus.length,
            cores: cpus.map(cpu => {
                const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
                const idle = cpu.times.idle;
                return 1 - (idle / total);
            })
        };
        this.metrics.cpuUsage.push(cpuUsage);

        this.checkThresholds(memoryUsage, cpuUsage.average);
    }

    checkThresholds(memoryUsage, cpuUsage) {
        const now = Date.now();

        if (memoryUsage > this.thresholds.memoryWarning &&
            (!this.metrics.alerts.has('memory') ||
             now - this.metrics.alerts.get('memory') > this.thresholds.alertCooldown)) {
            LogManager.warning('High memory usage', {
                usage: `${(memoryUsage * 100).toFixed(2)}%`,
                threshold: `${(this.thresholds.memoryWarning * 100).toFixed(2)}%`
            });
            this.metrics.alerts.set('memory', now);
        }

        if (cpuUsage > this.thresholds.highCpuUsage &&
            (!this.metrics.alerts.has('cpu') ||
             now - this.metrics.alerts.get('cpu') > this.thresholds.alertCooldown)) {
            LogManager.warning('High CPU usage', {
                usage: `${(cpuUsage * 100).toFixed(2)}%`,
                threshold: `${(this.thresholds.highCpuUsage * 100).toFixed(2)}%`
            });
            this.metrics.alerts.set('cpu', now);
        }
    }

    trackRequestRate() {
        const now = Date.now();
        this.metrics.requestsPerMinute.push({
            timestamp: now,
            count: this.metrics.requests,
            errors: this.metrics.errors
        });

        const minuteAgo = now - 60000;
        const recentRequests = this.metrics.requestsPerMinute.filter(r => r.timestamp > minuteAgo);
        const requestRate = recentRequests.reduce((acc, curr) => acc + curr.count, 0);

        if (requestRate > this.thresholds.requestRateWarning &&
            (!this.metrics.alerts.has('requestRate') ||
             now - this.metrics.alerts.get('requestRate') > this.thresholds.alertCooldown)) {
            LogManager.warning(`High request rate: ${requestRate} requests/minute`);
            this.metrics.alerts.set('requestRate', now);
        }
    }

    trackRequest(responseTime, statusCode, endpoint) {
        const now = Date.now();
        this.metrics.requests++;
        this.metrics.totalResponseTime += responseTime;
        this.metrics.avgResponseTime = this.metrics.totalResponseTime / this.metrics.requests;

        this.metrics.responseTimeHistory.push({
            timestamp: now,
            responseTime,
            endpoint
        });

        this.metrics.statusCodes[statusCode] = (this.metrics.statusCodes[statusCode] || 0) + 1;

        if (!this.metrics.endpoints[endpoint]) {
            this.metrics.endpoints[endpoint] = {
                count: 0,
                totalTime: 0,
                avgTime: 0,
                lastUsed: now
            };
        }
        const endpointMetrics = this.metrics.endpoints[endpoint];
        endpointMetrics.count++;
        endpointMetrics.totalTime += responseTime;
        endpointMetrics.avgTime = endpointMetrics.totalTime / endpointMetrics.count;
        endpointMetrics.lastUsed = now;

        if (responseTime > this.thresholds.slowResponseTime) {
            this.metrics.slowestEndpoints.set(endpoint, {
                responseTime,
                timestamp: now
            });
            LogManager.warning('Slow response time detected', {
                endpoint,
                responseTime: `${responseTime}ms`,
                threshold: `${this.thresholds.slowResponseTime}ms`
            });
        }
    }

    trackError(error, endpoint) {
        this.metrics.errors++;
        LogManager.error(`Error in endpoint ${endpoint}`, error);
    }

    getUptime() {
        const [seconds] = process.hrtime(this.startTime);
        const days = Math.floor(seconds / (24 * 3600));
        const hours = Math.floor((seconds % (24 * 3600)) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
    }

    getMetrics() {
        const memUsage = process.memoryUsage();
        const now = Date.now();
        const minuteAgo = now - 60000;
        const hourAgo = now - 3600000;

        const recentRequests = this.metrics.responseTimeHistory.filter(r => r.timestamp > minuteAgo);
        const hourlyRequests = this.metrics.responseTimeHistory.filter(r => r.timestamp > hourAgo);

        const currentResponseTime = recentRequests.reduce((acc, curr) => acc + curr.responseTime, 0) / (recentRequests.length || 1);
        const hourlyResponseTime = hourlyRequests.reduce((acc, curr) => acc + curr.responseTime, 0) / (hourlyRequests.length || 1);

        return {
            ...this.metrics,
            uptime: this.getUptime(),
            memoryUsage: {
                heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
                heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
                rss: (memUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
                external: (memUsage.external / 1024 / 1024).toFixed(2) + ' MB'
            },
            currentCpuUsage: (this.metrics.cpuUsage[this.metrics.cpuUsage.length - 1]?.average * 100 || 0).toFixed(2) + '%',
            successRate: ((this.metrics.requests - this.metrics.errors) / this.metrics.requests * 100).toFixed(2) + '%',
            trends: {
                responseTime: {
                    current: currentResponseTime,
                    hourly: hourlyResponseTime,
                    trend: ((currentResponseTime - hourlyResponseTime) / hourlyResponseTime * 100).toFixed(2) + '%'
                },
                requestRate: {
                    current: recentRequests.length,
                    hourly: hourlyRequests.length / 60,
                    trend: ((recentRequests.length - hourlyRequests.length/60) / (hourlyRequests.length/60) * 100).toFixed(2) + '%'
                }
            }
        };
    }

    logMetrics() {
        const metrics = this.getMetrics();
        LogManager.info('=== Server Performance Metrics ===', {
            uptime: metrics.uptime,
            totalRequests: metrics.requests,
            errorRate: `${(metrics.errors / metrics.requests * 100).toFixed(2)}%`,
            successRate: metrics.successRate,
            avgResponseTime: `${metrics.avgResponseTime.toFixed(2)}ms`,
            memoryUsage: metrics.memoryUsage,
            cpuUsage: metrics.currentCpuUsage
        });
    }

    setThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        LogManager.info('Performance thresholds updated', { newThresholds });
    }

    getEndpointMetrics(endpoint) {
        return this.metrics.endpoints[endpoint] || null;
    }

    getSlowestEndpoints(limit = 5) {
        return Array.from(this.metrics.slowestEndpoints)
            .sort((a, b) => b[1].responseTime - a[1].responseTime)
            .slice(0, limit);
    }
}

module.exports = new PerformanceManager();