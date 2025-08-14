/**
 * Cluster Manager for Unknown Server
 * 
 * This script enables the server to utilize all available CPU cores by creating
 * worker processes through Node.js cluster module. This significantly improves
 * performance and request handling capacity.
 * 
 * In production, this should be the main entry point rather than server.js directly.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import cluster, { Worker } from 'cluster';
import os from 'os';

const LogManager = require('./managers/LogManager');

// Interface for worker memory stats
interface WorkerMemoryStats {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    pid: number;
    workerId: number;
}

// Interface for inter-worker messages
interface WorkerMessage {
    type: 'websocket:broadcast' | 'cache:operation' | 'stats:request' | 'stats:response';
    statsType?: 'memory';
    stats?: WorkerMemoryStats;
    data?: any;
}

// Determine the number of CPU cores available
const numCPUs: number = os.cpus().length;

// Optional: Allow overriding number of workers via environment variable
const WORKERS: number = parseInt(process.env.SERVER_WORKERS || numCPUs.toString(), 10);

// Required environment variables check function
const checkRequiredEnvVars = (): void => {
    const requiredEnvVars: string[] = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName]?.trim() === '');
    
    if (missingEnvVars.length > 0) {
        LogManager.warning('Missing mandatory environment variables:', missingEnvVars);
        LogManager.error('Please set the required environment variables before starting the clustering. Exiting with code 1.');
        process.exit(1);
    }
};

// Analyze memory usage across the cluster
const analyzeClusterMemoryUsage = (stats: Record<string, WorkerMemoryStats>): void => {
    // Only analyze if we have stats for all workers
    const workerIds = Object.keys(stats);
    if (workerIds.length < Object.keys(cluster.workers || {}).length) return;

    // Calculate total and average memory usage
    let totalMemory = 0;
    let maxMemoryWorker: { id: string | null; memory: number } = { id: null, memory: 0 };

    workerIds.forEach((id: string) => {
        const workerMemory = stats[id].heapUsed;
        totalMemory += workerMemory;

        if (workerMemory > maxMemoryWorker.memory) {
            maxMemoryWorker = { id, memory: workerMemory };
        }
    });

    const avgMemory = totalMemory / workerIds.length;

    // Log memory usage summary
    LogManager.info(`Cluster memory usage - Total: ${totalMemory.toFixed(2)}MB, Average: ${avgMemory.toFixed(2)}MB per worker`);

    // Check for outliers (workers using significantly more memory)
    if (maxMemoryWorker.memory > avgMemory * 1.5) {
        LogManager.warning(`Worker ${maxMemoryWorker.id} is using ${maxMemoryWorker.memory.toFixed(2)}MB memory, which is ${((maxMemoryWorker.memory / avgMemory) * 100).toFixed(0)}% of the average`);
    }
};

// Check if current process is primary/master
if (cluster.isPrimary) {
    // Check for required env variables
    checkRequiredEnvVars();
    
    LogManager.info(`Master process ${process.pid} is running`);
    LogManager.info(`Starting ${WORKERS} worker processes...`);

    // Store active workers
    const workers = new Set<Worker>();

    // Fork workers equal to the number of CPUs
    for (let i = 0; i < WORKERS; i++) {
        const worker = cluster.fork({
            // Setting environment variables for worker processes
            CLUSTER_WORKER: 'true'
        });

        if (worker) {
            workers.add(worker);
        }
    }

    // Handle worker exits and restart them
    cluster.on('exit', (worker: Worker, code: number, signal: string) => {
        workers.delete(worker);
        LogManager.warning(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);

        // Restart worker after a brief delay
        setTimeout(() => {
            LogManager.info('Starting a new worker...');
            const newWorker = cluster.fork({
                CLUSTER_WORKER: 'true'
            });
            if (newWorker) {
                workers.add(newWorker);
            }
        }, 1000);
    });

    // Message handling for communication between workers
    cluster.on('message', (worker: Worker, message: WorkerMessage) => {
        if (message.type === 'websocket:broadcast') {
            // Forward websocket messages to other workers
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id && !otherWorker.isDead()) {
                    otherWorker.send(message);
                }
            }
        } else if (message.type === 'cache:operation') {
            // Forward cache operations to all other workers
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id && !otherWorker.isDead()) {
                    otherWorker.send(message);
                }
            }
        }
    });

    // Periodically collect and log memory stats from workers
    setInterval(() => {
        const numWorkers = Object.keys(cluster.workers || {}).length;
        LogManager.debug(`Active workers: ${numWorkers}`);

        // Request memory stats from all workers
        for (const worker of workers) {
            if (!worker.isDead()) {
                worker.send({ type: 'stats:request', statsType: 'memory' });
            }
        }
    }, 300000); // Every 5 minutes

    // Track worker memory stats
    const workersMemoryStats: Record<string, WorkerMemoryStats> = {};
    cluster.on('message', (worker: Worker, message: WorkerMessage) => {
        if (message.type === 'stats:response' && message.statsType === 'memory' && message.stats) {
            workersMemoryStats[worker.id?.toString() || ''] = message.stats;

            // Check for potential memory leaks across workers
            analyzeClusterMemoryUsage(workersMemoryStats);
        }
    });

    // Handle graceful shutdown
    const handleShutdown = (): void => {
        LogManager.info('Received SIGTERM signal, shutting down gracefully...');

        // Notify all workers to finish and exit
        for (const worker of workers) {
            if (!worker.isDead()) {
                worker.send('shutdown');

                // Set a timeout to force kill if graceful shutdown doesn't work
                setTimeout(() => {
                    if (!worker.isDead()) {
                        LogManager.warning(`Force killing worker ${worker.process.pid}`);
                        worker.kill('SIGKILL');
                    }
                }, 5000);
            }
        }

        // Exit the master process after all workers have finished
        const checkWorkersInterval = setInterval(() => {
            if (workers.size === 0) {
                LogManager.info('All workers shut down, exiting master process');
                clearInterval(checkWorkersInterval);
                process.exit(0);
            }
        }, 1000);

        // Force exit after timeout if something hangs
        setTimeout(() => {
            LogManager.error('Force exiting master after timeout');
            clearInterval(checkWorkersInterval);
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

} else {
    // Worker processes will run the actual server
    LogManager.info(`Worker ${process.pid} started`);

    // Listen for shutdown signal from master
    process.on('message', (msg: string | WorkerMessage) => {
        if (msg === 'shutdown') {
            LogManager.info(`Worker ${process.pid} received shutdown signal`);
            // The shutdown process itself is handled by server.js
            // We just need to pass along the signal
        } else if (typeof msg === 'object' && msg.type === 'stats:request') {
            // Handle stats requests from master
            if (msg.statsType === 'memory') {
                const memoryStats = process.memoryUsage();

                if (process.send) {
                    process.send({
                        type: 'stats:response',
                        statsType: 'memory',
                        stats: {
                            heapUsed: memoryStats.heapUsed / 1024 / 1024,  // Convert to MB
                            heapTotal: memoryStats.heapTotal / 1024 / 1024, // Convert to MB
                            rss: memoryStats.rss / 1024 / 1024,            // Convert to MB
                            pid: process.pid,
                            workerId: cluster.worker?.id || 0
                        }
                    } as WorkerMessage);
                }
            }
        }
    });

    // Load the server script
    require('./server');
}