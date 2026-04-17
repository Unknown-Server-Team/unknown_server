export type WorkerTaskValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | WorkerTaskValue[]
    | { [key: string]: WorkerTaskValue };

export interface WorkerTaskData {
    [key: string]: WorkerTaskValue;
}

export interface WorkerTaskOptions {
    [key: string]: WorkerTaskValue;
}

export interface WorkerMessage<ResultType> {
    result?: ResultType;
    error?: string;
}

export interface WorkerTaskEntry<ResultType> {
    resolve: (value: ResultType) => void;
    reject: (reason?: unknown) => void;
    startTime: number;
    taskType: string;
}

export interface WorkerThreadStats {
    maxWorkers: number;
    activeWorkers: number;
    pendingTasks: number;
    workerList: Array<{
        id: string;
        taskType: string;
        runningTime: number;
    }>;
}

export interface WorkerThreadOptions {
    maxWorkers?: number;
}

export interface GenericWorkerData {
    taskId: string;
    data: unknown;
    options: Record<string, unknown>;
}

export interface WorkerLogEntry {
    timestamp: string;
    level: string;
    message: string;
    [key: string]: unknown;
}

export interface GenericWorkerResult {
    processed: boolean;
    originalData: unknown;
    appliedOptions: Record<string, unknown>;
    timestamp: string;
    workerId: number;
}
