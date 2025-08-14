/**
 * Generic Worker Thread Implementation
 * 
 * This is a template worker thread that handles communication with the main thread
 * and provides a basic structure for task execution. Specific worker implementations
 * can extend this pattern.
 */

import { workerData, parentPort } from 'worker_threads';

// Extract task information from worker data
interface WorkerData {
    taskId: string;
    data: any;
    options: Record<string, any>;
}

interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    [key: string]: any;
}

interface WorkerResult {
    processed: boolean;
    originalData: any;
    appliedOptions: Record<string, any>;
    timestamp: string;
    workerId: number;
}

interface WorkerMessage {
    result?: any;
    error?: string;
    stack?: string;
}

const { taskId, data, options }: WorkerData = workerData || {};

/**
 * Simplified logger for worker threads
 */
function workerLog(level: string, message: string, meta: Record<string, any> = {}): void {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    
    // Format the log entry
    const logEntry: LogEntry = {
        timestamp,
        level,
        message: `[Worker ${pid}] ${message}`,
        ...meta
    };
    
    console.log(JSON.stringify(logEntry));
}

// Main worker execution function
async function executeTask(): Promise<void> {
    try {
        // Log the start of processing
        workerLog('info', `Starting task ${taskId}`);
        
        // Execute the task (this would be replaced with actual task logic in specific workers)
        const result = await processData(data, options);
        
        // Send the result back to the main thread
        if (parentPort) {
            parentPort.postMessage({ result } as WorkerMessage);
        }
        
    } catch (error: any) {
        // Handle and report any errors
        workerLog('error', `Error executing task ${taskId}`, { 
            error: error.message,
            stack: error.stack
        });
        
        if (parentPort) {
            parentPort.postMessage({ 
                error: error.message,
                stack: error.stack
            } as WorkerMessage);
        }
    }
}

/**
 * Generic data processing function - to be overridden in specific worker implementations
 */
async function processData(data: any, options: Record<string, any>): Promise<WorkerResult> {
    // This is a placeholder - specific workers would implement their own logic here
    return {
        processed: true,
        originalData: data,
        appliedOptions: options,
        timestamp: new Date().toISOString(),
        workerId: process.pid
    };
}

// Start task execution
executeTask();