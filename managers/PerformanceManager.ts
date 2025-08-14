import { LogManager } from './LogManager';
import os from 'os';

interface PerformanceMetrics {
    requests: number;
    errors: number;
    avgResponseTime: number;
    totalResponseTime: number;
    statusCodes: Record<string, number>;
    endpoints: Record<string, EndpointMetrics>;
    maxMemoryUsage: number;
    cpuUsage: CpuUsageSnapshot[];
    slowestEndpoints: Map<string, SlowEndpointRecord>;
    requestsPerMinute: RequestRateRecord[];
    historyRetentionHours: number;
    responseTimeHistory: ResponseTimeRecord[];
    alerts: Map<string, number>;
}

interface EndpointMetrics {
    count: number;
    totalTime: number;
    avgTime: number;
    lastUsed: number;
}

interface CpuUsageSnapshot {
    timestamp: number;
    average: number;
    cores: number[];
}

interface SlowEndpointRecord {
    responseTime: number;
    timestamp: number;
}

interface RequestRateRecord {
    timestamp: number;
    count: number;
    errors: number;
}

interface ResponseTimeRecord {
    timestamp: number;
    responseTime: number;
    endpoint: string;
}

interface PerformanceThresholds {
    memoryWarning: number;
    slowResponseTime: number;
    highCpuUsage: number;
    requestRateWarning: number;
    errorRateWarning: number;
    alertCooldown: number;
}

interface MemoryUsage {
    heapUsed: string;
    heapTotal: string;
    rss: string;
    external: string;
}

interface MetricsTrends {
    responseTime: {
        current: number;
        hourly: number;
        trend: string;
    };
    requestRate: {
        current: number;
        hourly: number;
        trend: string;
    };
}

interface MetricsReport {
    requests: number;
    errors: number;
    avgResponseTime: number;
    totalResponseTime: number;
    statusCodes: Record<string, number>;
    endpoints: Record<string, EndpointMetrics>;
    maxMemoryUsage: number;
    cpuUsage: CpuUsageSnapshot[];
    slowestEndpoints: Map<string, SlowEndpointRecord>;
    requestsPerMinute: RequestRateRecord[];
    historyRetentionHours: number;
    responseTimeHistory: ResponseTimeRecord[];
    alerts: Map<string, number>;
    uptime: string;
    memoryUsage: MemoryUsage;
    currentCpuUsage: string;
    successRate: string;
    trends: MetricsTrends;
}

class PerformanceManager {
    private startTime: [number, number];
    private metrics: PerformanceMetrics;
    private thresholds: PerformanceThresholds;

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
            // New metrics
            requestsPerMinute: [],
            historyRetentionHours: 24,
            responseTimeHistory: [],
            alerts: new Map()
        };
        
        this.thresholds = {
            memoryWarning: 0.85,
            slowResponseTime: 1000,
            highCpuUsage: 0.8,
            requestRateWarning: 1000, // requests per minute
            errorRateWarning: 0.1, // 10% error rate
            alertCooldown: 300000 // 5 minutes between repeated alerts
        };

        // Start monitoring system resources
        this.startMonitoring();
        this.startMetricsCleaning();
    }

    private startMonitoring(): void {
        // Monitor every 30 seconds
        setInterval(() => this.monitorResources(), 30000);
        // Track requests per minute
        setInterval(() => this.trackRequestRate(), 60000);
    }

    private startMetricsCleaning(): void {
        // Clean old metrics every hour
        setInterval(() => this.cleanOldMetrics(), 3600000);
    }

    private cleanOldMetrics(): void {
        const now = Date.now();
        const retentionTime = this.metrics.historyRetentionHours * 3600000;

        // Clean response time history
        this.metrics.responseTimeHistory = this.metrics.responseTimeHistory.filter(
            item => (now - item.timestamp) < retentionTime
        );

        // Clean CPU usage history (keep last hour)
        if (this.metrics.cpuUsage.length > 120) { // 30-second intervals for 1 hour
            this.metrics.cpuUsage = this.metrics.cpuUsage.slice(-120);
        }

        // Clean requests per minute history
        this.metrics.requestsPerMinute = this.metrics.requestsPerMinute.filter(
            item => (now - item.timestamp) < retentionTime
        );

        // Clean old alerts
        for (const [key, timestamp] of this.metrics.alerts) {
            if (now - timestamp > retentionTime) {
                this.metrics.alerts.delete(key);
            }
        }

        // Memory optimization for endpoints
        if (Object.keys(this.metrics.endpoints).length > 1000) {
            const sortedEndpoints = Object.entries(this.metrics.endpoints)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 1000);
            this.metrics.endpoints = Object.fromEntries(sortedEndpoints);
        }
    }

    private monitorResources(): void {
        const used = process.memoryUsage();
        const memoryUsage = used.heapUsed / used.heapTotal;
        this.metrics.maxMemoryUsage = Math.max(this.metrics.maxMemoryUsage, memoryUsage);

        // Detailed CPU monitoring
        const cpus = os.cpus();
        const cpuUsage: CpuUsageSnapshot = {
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

    private checkThresholds(memoryUsage: number, cpuUsage: number): void {
        const now = Date.now();
        
        // Memory check with cooldown
        if (memoryUsage > this.thresholds.memoryWarning && 
            (!this.metrics.alerts.has('memory') || 
             now - this.metrics.alerts.get('memory')! > this.thresholds.alertCooldown)) {
            LogManager.warning('High memory usage', {
                usage: `${(memoryUsage * 100).toFixed(2)}%`,
                threshold: `${(this.thresholds.memoryWarning * 100).toFixed(2)}%`
            });
            this.metrics.alerts.set('memory', now);
        }

        // CPU check with cooldown
        if (cpuUsage > this.thresholds.highCpuUsage && 
            (!this.metrics.alerts.has('cpu') || 
             now - this.metrics.alerts.get('cpu')! > this.thresholds.alertCooldown)) {
            LogManager.warning('High CPU usage', {
                usage: `${(cpuUsage * 100).toFixed(2)}%`,
                threshold: `${(this.thresholds.highCpuUsage * 100).toFixed(2)}%`
            });
            this.metrics.alerts.set('cpu', now);
        }
    }

    private trackRequestRate(): void {
        const now = Date.now();
        this.metrics.requestsPerMinute.push({
            timestamp: now,
            count: this.metrics.requests,
            errors: this.metrics.errors
        });

        // Calculate current request rate
        const minuteAgo = now - 60000;
        const recentRequests = this.metrics.requestsPerMinute.filter(r => r.timestamp > minuteAgo);
        const requestRate = recentRequests.reduce((acc, curr) => acc + curr.count, 0);

        if (requestRate > this.thresholds.requestRateWarning && 
            (!this.metrics.alerts.has('requestRate') || 
             now - this.metrics.alerts.get('requestRate')! > this.thresholds.alertCooldown)) {
            LogManager.warning(`High request rate: ${requestRate} requests/minute`);
            this.metrics.alerts.set('requestRate', now);
        }
    }

    trackRequest(responseTime: number, statusCode: number, endpoint: string): void {
        const now = Date.now();
        this.metrics.requests++;
        this.metrics.totalResponseTime += responseTime;
        this.metrics.avgResponseTime = this.metrics.totalResponseTime / this.metrics.requests;

        // Track response time history
        this.metrics.responseTimeHistory.push({
            timestamp: now,
            responseTime,
            endpoint
        });

        // Track status codes
        this.metrics.statusCodes[statusCode] = (this.metrics.statusCodes[statusCode] || 0) + 1;

        // Track endpoints
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

        // Track slow endpoints
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

    trackError(error: any, endpoint: string): void {
        this.metrics.errors++;
        LogManager.error(`Error in endpoint ${endpoint}`, error);
    }

    getUptime(): string {
        const [seconds] = process.hrtime(this.startTime);
        const days = Math.floor(seconds / (24 * 3600));
        const hours = Math.floor((seconds % (24 * 3600)) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
    }

    getMetrics(): MetricsReport {
        const memUsage = process.memoryUsage();
        const now = Date.now();
        const minuteAgo = now - 60000;
        const hourAgo = now - 3600000;

        // Calculate trends
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

    logMetrics(): void {
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

    setThresholds(newThresholds: Partial<PerformanceThresholds>): void {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        LogManager.info('Performance thresholds updated', { newThresholds });
    }

    getEndpointMetrics(endpoint: string): EndpointMetrics | null {
        return this.metrics.endpoints[endpoint] || null;
    }

    getSlowestEndpoints(limit: number = 5): Array<[string, SlowEndpointRecord]> {
        return Array.from(this.metrics.slowestEndpoints)
            .sort((a, b) => b[1].responseTime - a[1].responseTime)
            .slice(0, limit);
    }
}

export const performanceManager = new PerformanceManager();
export default performanceManager;