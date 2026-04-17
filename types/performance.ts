export interface StatusCodeMetrics {
    [statusCode: number]: number;
}

export interface EndpointMetrics {
    count: number;
    totalTime: number;
    avgTime: number;
    lastUsed: number;
}

export interface EndpointMetricsMap {
    [endpoint: string]: EndpointMetrics;
}

export interface CpuUsageSample {
    timestamp: number;
    average: number;
    cores: number[];
}

export interface CpuTimeMetrics {
    user: number;
    nice: number;
    sys: number;
    idle: number;
    irq: number;
}

export interface CpuInfoRecord {
    times: CpuTimeMetrics;
}

export interface RequestRateSample {
    timestamp: number;
    count: number;
    errors: number;
}

export interface ResponseTimeSample {
    timestamp: number;
    responseTime: number;
    endpoint: string;
}

export interface SlowEndpointRecord {
    responseTime: number;
    timestamp: number;
}

export interface PerformanceMetrics {
    requests: number;
    errors: number;
    avgResponseTime: number;
    totalResponseTime: number;
    statusCodes: StatusCodeMetrics;
    endpoints: EndpointMetricsMap;
    maxMemoryUsage: number;
    cpuUsage: CpuUsageSample[];
    slowestEndpoints: Map<string, SlowEndpointRecord>;
    requestsPerMinute: RequestRateSample[];
    historyRetentionHours: number;
    responseTimeHistory: ResponseTimeSample[];
    alerts: Map<string, number>;
}

export interface PerformanceThresholds {
    memoryWarning: number;
    slowResponseTime: number;
    highCpuUsage: number;
    requestRateWarning: number;
    errorRateWarning: number;
    alertCooldown: number;
}

export interface MemoryUsageMetrics {
    heapUsed: string;
    heapTotal: string;
    rss: string;
    external: string;
}

export interface PerformanceSnapshot extends PerformanceMetrics {
    uptime: string;
    memoryUsage: MemoryUsageMetrics;
    currentCpuUsage: string;
    successRate: string;
    trends: {
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
    };
}
