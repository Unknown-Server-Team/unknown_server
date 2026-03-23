require("dotenv").config();
const cluster = require('cluster');
const os = require('os');
const path = require('path');
const LogManager = require('./managers/LogManager');

const numCPUs = os.cpus().length;

const WORKERS = process.env.SERVER_WORKERS || numCPUs;

if (cluster.isPrimary || cluster.isMaster) {
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
    const missingEnnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');
    if (missingEnnvVars.length > 0) {
        LogManager.warning('Missing mandatory environment variables:', missingEnnvVars);
        LogManager.error('Please set the required environment variables before starting the clustering. Exitting with code 1.');
        process.exit(1);
    }
    LogManager.info(`Master process ${process.pid} is running`);
    LogManager.info(`Starting ${WORKERS} worker processes...`);

    const workers = new Set();

    for (let i = 0; i < WORKERS; i++) {
        const worker = cluster.fork({
            CLUSTER_WORKER: 'true'
        });

        workers.add(worker);
    }

    cluster.on('exit', (worker, code, signal) => {
        workers.delete(worker);
        LogManager.warning(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);

        setTimeout(() => {
            LogManager.info('Starting a new worker...');
            const newWorker = cluster.fork({
                CLUSTER_WORKER: 'true'
            });
            workers.add(newWorker);
        }, 1000);
    });

    cluster.on('message', (worker, message) => {
        if (message.type === 'websocket:broadcast') {
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id) {
                    otherWorker.send(message);
                }
            }
        } else if (message.type === 'cache:operation') {
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id) {
                    otherWorker.send(message);
                }
            }
        }
    });

    setInterval(() => {
        const numWorkers = Object.keys(cluster.workers).length;
        LogManager.debug(`Active workers: ${numWorkers}`);

        for (const worker of workers) {
            worker.send({ type: 'stats:request', statsType: 'memory' });
        }
    }, 300000);

    const workersMemoryStats = {};
    cluster.on('message', (worker, message) => {
        if (message.type === 'stats:response' && message.statsType === 'memory') {
            workersMemoryStats[worker.id] = message.stats;

            analyzeClusterMemoryUsage(workersMemoryStats);
        }
    });

    function analyzeClusterMemoryUsage(stats) {
        const workerIds = Object.keys(stats);
        if (workerIds.length < Object.keys(cluster.workers).length) return;

        let totalMemory = 0;
        let maxMemoryWorker = { id: null, memory: 0 };

        workerIds.forEach(id => {
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
    }

    process.on('SIGTERM', () => {
        LogManager.info('Received SIGTERM signal, shutting down gracefully...');

        for (const worker of workers) {
            worker.send('shutdown');

            setTimeout(() => {
                if (!worker.isDead()) {
                    LogManager.warning(`Force killing worker ${worker.process.pid}`);
                    worker.kill('SIGKILL');
                }
            }, 5000);
        }

        setInterval(() => {
            if (workers.size === 0) {
                LogManager.info('All workers shut down, exiting master process');
                process.exit(0);
            }
        }, 1000);

        setTimeout(() => {
            LogManager.error('Force exiting master after timeout');
            process.exit(1);
        }, 10000);
    });

    process.on('SIGINT', () => {
        process.emit('SIGTERM');
    });

} else {
    LogManager.info(`Worker ${process.pid} started`);

    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            LogManager.info(`Worker ${process.pid} received shutdown signal`);
        } else if (msg && msg.type === 'stats:request') {
            if (msg.statsType === 'memory') {
                const memoryStats = process.memoryUsage();

                process.send({
                    type: 'stats:response',
                    statsType: 'memory',
                    stats: {
                        heapUsed: memoryStats.heapUsed / 1024 / 1024,
                        heapTotal: memoryStats.heapTotal / 1024 / 1024,
                        rss: memoryStats.rss / 1024 / 1024,
                        pid: process.pid,
                        workerId: cluster.worker.id
                    }
                });
            }
        }
    });

    require('./server');
}