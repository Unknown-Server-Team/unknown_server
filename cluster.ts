import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import cluster, { Worker } from 'cluster';
import os from 'os';

const LogManager = require('./managers/LogManager');

interface WorkerMemoryStats {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    pid: number;
    workerId: number;
}

interface WorkerMessage {
    type: 'websocket:broadcast' | 'cache:operation' | 'stats:request' | 'stats:response';
    statsType?: 'memory';
    stats?: WorkerMemoryStats;
    data?: any;
}

const numCPUs: number = os.cpus().length;

const WORKERS: number = parseInt(process.env.SERVER_WORKERS || numCPUs.toString(), 10);

const checkRequiredEnvVars = (): void => {
    const requiredEnvVars: string[] = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName]?.trim() === '');

    if (missingEnvVars.length > 0) {
        LogManager.warning('Missing mandatory environment variables:', missingEnvVars);
        LogManager.error('Please set the required environment variables before starting the clustering. Exiting with code 1.');
        process.exit(1);
    }
};

const analyzeClusterMemoryUsage = (stats: Record<string, WorkerMemoryStats>): void => {
    const workerIds = Object.keys(stats);
    if (workerIds.length < Object.keys(cluster.workers || {}).length) return;

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

    LogManager.info(`Cluster memory usage - Total: ${totalMemory.toFixed(2)}MB, Average: ${avgMemory.toFixed(2)}MB per worker`);

    if (maxMemoryWorker.memory > avgMemory * 1.5) {
        LogManager.warning(`Worker ${maxMemoryWorker.id} is using ${maxMemoryWorker.memory.toFixed(2)}MB memory, which is ${((maxMemoryWorker.memory / avgMemory) * 100).toFixed(0)}% of the average`);
    }
};

if (cluster.isPrimary) {
    checkRequiredEnvVars();

    LogManager.info(`Master process ${process.pid} is running`);
    LogManager.info(`Starting ${WORKERS} worker processes...`);

    const workers = new Set<Worker>();

    for (let i = 0; i < WORKERS; i++) {
        const worker = cluster.fork({
            CLUSTER_WORKER: 'true'
        });

        if (worker) {
            workers.add(worker);
        }
    }

    cluster.on('exit', (worker: Worker, code: number, signal: string) => {
        workers.delete(worker);
        LogManager.warning(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);

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

    cluster.on('message', (worker: Worker, message: WorkerMessage) => {
        if (message.type === 'websocket:broadcast') {
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id && !otherWorker.isDead()) {
                    otherWorker.send(message);
                }
            }
        } else if (message.type === 'cache:operation') {
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id && !otherWorker.isDead()) {
                    otherWorker.send(message);
                }
            }
        }
    });

    setInterval(() => {
        const numWorkers = Object.keys(cluster.workers || {}).length;
        LogManager.debug(`Active workers: ${numWorkers}`);

        for (const worker of workers) {
            if (!worker.isDead()) {
                worker.send({ type: 'stats:request', statsType: 'memory' });
            }
        }
    }, 300000);

    const workersMemoryStats: Record<string, WorkerMemoryStats> = {};
    cluster.on('message', (worker: Worker, message: WorkerMessage) => {
        if (message.type === 'stats:response' && message.statsType === 'memory' && message.stats) {
            workersMemoryStats[worker.id?.toString() || ''] = message.stats;

            analyzeClusterMemoryUsage(workersMemoryStats);
        }
    });

    const handleShutdown = (): void => {
        LogManager.info('Received SIGTERM signal, shutting down gracefully...');

        for (const worker of workers) {
            if (!worker.isDead()) {
                worker.send('shutdown');

                setTimeout(() => {
                    if (!worker.isDead()) {
                        LogManager.warning(`Force killing worker ${worker.process.pid}`);
                        worker.kill('SIGKILL');
                    }
                }, 5000);
            }
        }

        const checkWorkersInterval = setInterval(() => {
            if (workers.size === 0) {
                LogManager.info('All workers shut down, exiting master process');
                clearInterval(checkWorkersInterval);
                process.exit(0);
            }
        }, 1000);

        setTimeout(() => {
            LogManager.error('Force exiting master after timeout');
            clearInterval(checkWorkersInterval);
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

} else {
    LogManager.info(`Worker ${process.pid} started`);

    process.on('message', (msg: string | WorkerMessage) => {
        if (msg === 'shutdown') {
            LogManager.info(`Worker ${process.pid} received shutdown signal`);
        } else if (typeof msg === 'object' && msg.type === 'stats:request') {
            if (msg.statsType === 'memory') {
                const memoryStats = process.memoryUsage();

                if (process.send) {
                    process.send({
                        type: 'stats:response',
                        statsType: 'memory',
                        stats: {
                            heapUsed: memoryStats.heapUsed / 1024 / 1024,
                            heapTotal: memoryStats.heapTotal / 1024 / 1024,
                            rss: memoryStats.rss / 1024 / 1024,
                            pid: process.pid,
                            workerId: cluster.worker?.id || 0
                        }
                    } as WorkerMessage);
                }
            }
        }
    });

    require('./server');
}