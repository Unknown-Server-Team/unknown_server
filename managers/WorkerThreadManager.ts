/**
 * WorkerThreadManager.ts
 * 
 * This manager handles CPU-intensive operations by offloading them to worker threads,
 * preventing them from blocking the main event loop. This is particularly useful for
 * operations like complex calculations, data processing, or encryption.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import path from 'path';
import os from 'os';
import { LogManager } from './LogManager';

interface TaskInfo {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    startTime: number;
    taskType: string;
}

interface WorkerStats {
    maxWorkers: number;
    activeWorkers: number;
    pendingTasks: number;
    workerList: Array<{
        id: string;
        taskType: string;
        runningTime: number;
    }>;
}

interface WorkerMessage {
    error?: string;
    result?: any;
}

interface WorkerManagerOptions {
    maxWorkers?: number;
}

interface WorkerTaskOptions {
    [key: string]: any;
}

interface WorkerDataPayload {
    taskId: string;
    data: any;
    options: WorkerTaskOptions;
}

class WorkerThreadManager {
    private workers: Map<string, Worker>;
    private taskQueue: Map<string, TaskInfo>;
    private maxWorkers: number;
    private activeWorkers: number;

    constructor() {
        this.workers = new Map();
        this.taskQueue = new Map();
        this.maxWorkers = os.cpus().length;
        this.activeWorkers = 0;
    }

    /**
     * Initialize the worker thread pool
     * @param options - Configuration options
     */
    initialize(options: WorkerManagerOptions = {}): void {
        this.maxWorkers = options.maxWorkers || this.maxWorkers;
        LogManager.info(`WorkerThreadManager initialized with max ${this.maxWorkers} workers`);
    }

    /**
     * Execute a CPU-intensive task in a worker thread
     * 
     * @param taskType - The type of task to execute (used for worker file selection)
     * @param data - The data needed by the worker to perform the task
     * @param options - Additional options for task execution
     * @returns Promise that resolves with the result of the worker's execution
     */
    executeTask(taskType: string, data: any, options: WorkerTaskOptions = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                // Determine the worker script path based on task type
                const workerPath = this._getWorkerPath(taskType);
                
                // Generate a unique task ID
                const taskId = `${taskType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                // Create a new worker
                const worker = new Worker(workerPath, {
                    workerData: {
                        taskId,
                        data,
                        options
                    } as WorkerDataPayload
                });
                
                // Store the worker and task info
                this.workers.set(taskId, worker);
                this.taskQueue.set(taskId, {
                    resolve,
                    reject,
                    startTime: Date.now(),
                    taskType
                });
                
                this.activeWorkers++;
                
                // Handle worker messages
                worker.on('message', (message: WorkerMessage) => {
                    const task = this.taskQueue.get(taskId);
                    if (!task) return;
                    
                    if (message.error) {
                        task.reject(new Error(message.error));
                    } else {
                        task.resolve(message.result);
                    }
                    
                    // Clean up resources
                    this._cleanupWorker(taskId);
                });
                
                // Handle worker errors
                worker.on('error', (err: Error) => {
                    LogManager.error(`Worker thread error (${taskType})`, err);
                    const task = this.taskQueue.get(taskId);
                    if (task) {
                        task.reject(err);
                    }
                    this._cleanupWorker(taskId);
                });
                
                // Handle worker exit
                worker.on('exit', (code: number) => {
                    if (code !== 0 && this.taskQueue.has(taskId)) {
                        LogManager.error(`Worker stopped with exit code ${code}`);
                        const task = this.taskQueue.get(taskId);
                        if (task) {
                            task.reject(new Error(`Worker thread exited with code ${code}`));
                        }
                        this._cleanupWorker(taskId);
                    }
                });
                
                LogManager.debug(`Started worker thread for task ${taskType} (${taskId})`);
                
            } catch (err) {
                LogManager.error('Failed to create worker thread', err);
                reject(err);
            }
        });
    }

    /**
     * Clean up resources associated with a completed worker
     * @param taskId - The ID of the completed task
     * @private
     */
    private _cleanupWorker(taskId: string): void {
        if (this.workers.has(taskId)) {
            const worker = this.workers.get(taskId)!;
            worker.terminate().catch(err => {
                LogManager.error(`Error terminating worker ${taskId}`, err);
            });
            
            this.workers.delete(taskId);
            this.taskQueue.delete(taskId);
            this.activeWorkers--;
            
            LogManager.debug(`Worker thread ${taskId} terminated. Active workers: ${this.activeWorkers}`);
        }
    }

    /**
     * Get the appropriate worker script path based on task type
     * @param taskType - The type of task to execute
     * @returns Path to the worker script
     * @private
     */
    private _getWorkerPath(taskType: string): string {
        // Map task types to worker script paths
        const workerPaths: Record<string, string> = {
            'encryption': path.join(__dirname, 'workers', 'encryption.worker.js'),
            'compression': path.join(__dirname, 'workers', 'compression.worker.js'),
            'dataProcessing': path.join(__dirname, 'workers', 'dataProcessing.worker.js'),
            'imageProcessing': path.join(__dirname, 'workers', 'imageProcessing.worker.js'),
            'default': path.join(__dirname, 'workers', 'generic.worker.js')
        };
        
        return workerPaths[taskType] || workerPaths.default;
    }

    /**
     * Get current worker thread statistics
     * @returns Statistics about worker threads
     */
    getStats(): WorkerStats {
        return {
            maxWorkers: this.maxWorkers,
            activeWorkers: this.activeWorkers,
            pendingTasks: this.taskQueue.size,
            workerList: Array.from(this.taskQueue.entries()).map(([id, task]) => ({
                id,
                taskType: task.taskType,
                runningTime: Date.now() - task.startTime
            }))
        };
    }

    /**
     * Gracefully terminate all worker threads
     * @returns Promise that resolves when all workers are terminated
     */
    async shutdownAll(): Promise<void> {
        LogManager.info(`Shutting down ${this.workers.size} worker threads`);
        
        const terminationPromises: Promise<any>[] = [];
        
        for (const [taskId, worker] of this.workers.entries()) {
            terminationPromises.push(
                worker.terminate().catch(err => {
                    LogManager.error(`Error terminating worker ${taskId}`, err);
                })
            );
        }
        
        await Promise.allSettled(terminationPromises);
        
        this.workers.clear();
        this.taskQueue.clear();
        this.activeWorkers = 0;
        
        LogManager.info('All worker threads shut down');
    }
}

export const workerThreadManager = new WorkerThreadManager();
export default workerThreadManager;