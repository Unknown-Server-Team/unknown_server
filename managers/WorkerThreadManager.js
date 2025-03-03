/**
 * WorkerThreadManager.js
 * 
 * This manager handles CPU-intensive operations by offloading them to worker threads,
 * preventing them from blocking the main event loop. This is particularly useful for
 * operations like complex calculations, data processing, or encryption.
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');
const LogManager = require('./LogManager');

class WorkerThreadManager {
    constructor() {
        this.workers = new Map();
        this.taskQueue = new Map();
        this.maxWorkers = os.cpus().length;
        this.activeWorkers = 0;
    }

    /**
     * Initialize the worker thread pool
     * @param {Object} options - Configuration options
     * @param {Number} options.maxWorkers - Maximum number of worker threads (defaults to CPU count)
     */
    initialize(options = {}) {
        this.maxWorkers = options.maxWorkers || this.maxWorkers;
        LogManager.info(`WorkerThreadManager initialized with max ${this.maxWorkers} workers`);
    }

    /**
     * Execute a CPU-intensive task in a worker thread
     * 
     * @param {String} taskType - The type of task to execute (used for worker file selection)
     * @param {Object} data - The data needed by the worker to perform the task
     * @param {Object} options - Additional options for task execution
     * @returns {Promise} - Resolves with the result of the worker's execution
     */
    executeTask(taskType, data, options = {}) {
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
                    }
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
                worker.on('message', (message) => {
                    if (message.error) {
                        this.taskQueue.get(taskId).reject(new Error(message.error));
                    } else {
                        this.taskQueue.get(taskId).resolve(message.result);
                    }
                    
                    // Clean up resources
                    this._cleanupWorker(taskId);
                });
                
                // Handle worker errors
                worker.on('error', (err) => {
                    LogManager.error(`Worker thread error (${taskType})`, err);
                    this.taskQueue.get(taskId).reject(err);
                    this._cleanupWorker(taskId);
                });
                
                // Handle worker exit
                worker.on('exit', (code) => {
                    if (code !== 0 && this.taskQueue.has(taskId)) {
                        LogManager.error(`Worker stopped with exit code ${code}`);
                        this.taskQueue.get(taskId).reject(
                            new Error(`Worker thread exited with code ${code}`)
                        );
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
     * @param {String} taskId - The ID of the completed task
     * @private
     */
    _cleanupWorker(taskId) {
        if (this.workers.has(taskId)) {
            const worker = this.workers.get(taskId);
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
     * @param {String} taskType - The type of task to execute
     * @returns {String} - Path to the worker script
     * @private
     */
    _getWorkerPath(taskType) {
        // Map task types to worker script paths
        const workerPaths = {
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
     * @returns {Object} - Statistics about worker threads
     */
    getStats() {
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
     * @returns {Promise} - Resolves when all workers are terminated
     */
    async shutdownAll() {
        LogManager.info(`Shutting down ${this.workers.size} worker threads`);
        
        const terminationPromises = [];
        
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

module.exports = new WorkerThreadManager();