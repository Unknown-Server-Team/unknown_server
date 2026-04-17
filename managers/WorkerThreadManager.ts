import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import type {
    WorkerMessage,
    WorkerTaskEntry,
    WorkerTaskData,
    WorkerTaskOptions,
    WorkerThreadStats,
    WorkerThreadOptions
} from '../types/worker';
import type { LogManagerModule } from '../types/modules';

const LogManager = require('./LogManager') as LogManagerModule;

class WorkerThreadManager {
    private workers: Map<string, Worker>;
    private taskQueue: Map<string, WorkerTaskEntry<unknown>>;
    private maxWorkers: number;
    private activeWorkers: number;

    constructor() {
        this.workers = new Map<string, Worker>();
        this.taskQueue = new Map<string, WorkerTaskEntry<unknown>>();
        this.maxWorkers = os.cpus().length;
        this.activeWorkers = 0;
    }

    initialize(options: WorkerThreadOptions = {}): void {
        this.maxWorkers = options.maxWorkers || this.maxWorkers;
        LogManager.info(`WorkerThreadManager initialized with max ${this.maxWorkers} workers`);
    }

    executeTask<ResultType>(taskType: string, data: WorkerTaskData, options: WorkerTaskOptions = {}): Promise<ResultType> {
        return new Promise<ResultType>((resolve, reject): void => {
            try {
                const workerPath = this._getWorkerPath(taskType);
                const taskId = `${taskType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const worker = new Worker(workerPath, {
                    workerData: {
                        taskId,
                        data,
                        options
                    }
                });

                this.workers.set(taskId, worker);
                this.taskQueue.set(taskId, {
                    resolve: resolve as (value: unknown) => void,
                    reject,
                    startTime: Date.now(),
                    taskType
                });

                this.activeWorkers++;

                worker.on('message', (message: WorkerMessage<ResultType>): void => {
                    const task = this.taskQueue.get(taskId);
                    if (!task) {
                        return;
                    }

                    if (message.error) {
                        task.reject(new Error(message.error));
                    } else {
                        task.resolve(message.result as ResultType);
                    }

                    this._cleanupWorker(taskId);
                });

                worker.on('error', (error: Error): void => {
                    LogManager.error(`Worker thread error (${taskType})`, error);
                    const task = this.taskQueue.get(taskId);
                    if (task) {
                        task.reject(error);
                    }
                    this._cleanupWorker(taskId);
                });

                worker.on('exit', (code: number): void => {
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
            } catch (error: unknown) {
                LogManager.error('Failed to create worker thread', error);
                reject(error);
            }
        });
    }

    private _cleanupWorker(taskId: string): void {
        if (this.workers.has(taskId)) {
            const worker = this.workers.get(taskId);
            if (worker) {
                void worker.terminate().catch((error: unknown): void => {
                    LogManager.error(`Error terminating worker ${taskId}`, error);
                });
            }

            this.workers.delete(taskId);
            this.taskQueue.delete(taskId);
            this.activeWorkers--;
            LogManager.debug(`Worker thread ${taskId} terminated. Active workers: ${this.activeWorkers}`);
        }
    }

    private _getWorkerPath(taskType: string): string {
        const workerPaths: Record<string, string> = {
            encryption: path.join(__dirname, 'workers', 'encryption.worker.js'),
            compression: path.join(__dirname, 'workers', 'compression.worker.js'),
            dataProcessing: path.join(__dirname, 'workers', 'dataProcessing.worker.js'),
            imageProcessing: path.join(__dirname, 'workers', 'imageProcessing.worker.js'),
            default: path.join(__dirname, 'workers', 'generic.worker.js')
        };

        return workerPaths[taskType] || workerPaths.default;
    }

    getStats(): WorkerThreadStats {
        return {
            maxWorkers: this.maxWorkers,
            activeWorkers: this.activeWorkers,
            pendingTasks: this.taskQueue.size,
            workerList: Array.from(this.taskQueue.entries()).map(
                ([id, task]: [string, WorkerTaskEntry<unknown>]): { id: string; taskType: string; runningTime: number } => ({
                    id,
                    taskType: task.taskType,
                    runningTime: Date.now() - task.startTime
                })
            )
        };
    }

    async shutdownAll(): Promise<void> {
        LogManager.info(`Shutting down ${this.workers.size} worker threads`);
        const terminationPromises: Array<Promise<number>> = [];

        for (const [taskId, worker] of this.workers.entries()) {
            terminationPromises.push(
                worker.terminate().catch((error: unknown): number => {
                    LogManager.error(`Error terminating worker ${taskId}`, error);
                    return 0;
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

const workerThreadManager = new WorkerThreadManager();

module.exports = workerThreadManager;
module.exports.WorkerThreadManager = workerThreadManager;
