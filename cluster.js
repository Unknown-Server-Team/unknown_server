/**
 * Cluster Manager for Unknown Server
 * 
 * This script enables the server to utilize all available CPU cores by creating
 * worker processes through Node.js cluster module. This significantly improves
 * performance and request handling capacity.
 * 
 * In production, this should be the main entry point rather than server.js directly.
 */
require("dotenv").config();
const cluster = require('cluster');
const os = require('os');
const path = require('path');
const LogManager = require('./managers/LogManager');

// Determine the number of CPU cores available
const numCPUs = os.cpus().length;

// Optional: Allow overriding number of workers via environment variable
const WORKERS = process.env.SERVER_WORKERS || numCPUs;

// Check if current process is primary/master
if (cluster.isPrimary || cluster.isMaster) {
    // Check for required env variables
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME', 'VERSION', 'JWT_SECRET', 'APP_URL'];
    const missingEnnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');
    if (missingEnnvVars.length > 0) {
        LogManager.warning('Missing mandatory environment variables:', missingEnnvVars);
        LogManager.error('Please set the required environment variables before starting the clustering. Exitting with code 1.');
        process.exit(1);
    }
    LogManager.info(`Master process ${process.pid} is running`);
    LogManager.info(`Starting ${WORKERS} worker processes...`);

    // Store active workers
    const workers = new Set();

    // Fork workers equal to the number of CPUs
    for (let i = 0; i < WORKERS; i++) {
        const worker = cluster.fork({
            // Setting environment variables for worker processes
            CLUSTER_WORKER: 'true'
        });

        workers.add(worker);
    }

    // Handle worker exits and restart them
    cluster.on('exit', (worker, code, signal) => {
        workers.delete(worker);
        LogManager.warning(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);

        // Restart worker after a brief delay
        setTimeout(() => {
            LogManager.info('Starting a new worker...');
            const newWorker = cluster.fork({
                CLUSTER_WORKER: 'true'
            });
            workers.add(newWorker);
        }, 1000);
    });

    // Message handling for communication between workers
    cluster.on('message', (worker, message) => {
        if (message.type === 'websocket:broadcast') {
            // Forward websocket messages to other workers
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id) {
                    otherWorker.send(message);
                }
            }
        } else if (message.type === 'cache:operation') {
            // Forward cache operations to all other workers
            for (const otherWorker of workers) {
                if (otherWorker.id !== worker.id) {
                    otherWorker.send(message);
                }
            }
        }
    });

    // Periodically collect and log memory stats from workers
    setInterval(() => {
        const numWorkers = Object.keys(cluster.workers).length;
        LogManager.debug(`Active workers: ${numWorkers}`);

        // Request memory stats from all workers
        for (const worker of workers) {
            worker.send({ type: 'stats:request', statsType: 'memory' });
        }
    }, 300000); // Every 5 minutes

    // Track worker memory stats
    const workersMemoryStats = {};
    cluster.on('message', (worker, message) => {
        if (message.type === 'stats:response' && message.statsType === 'memory') {
            workersMemoryStats[worker.id] = message.stats;

            // Check for potential memory leaks across workers
            analyzeClusterMemoryUsage(workersMemoryStats);
        }
    });

    // Analyze memory usage across the cluster
    function analyzeClusterMemoryUsage(stats) {
        // Only analyze if we have stats for all workers
        const workerIds = Object.keys(stats);
        if (workerIds.length < Object.keys(cluster.workers).length) return;

        // Calculate total and average memory usage
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

        // Log memory usage summary
        LogManager.info(`Cluster memory usage - Total: ${totalMemory.toFixed(2)}MB, Average: ${avgMemory.toFixed(2)}MB per worker`);

        // Check for outliers (workers using significantly more memory)
        if (maxMemoryWorker.memory > avgMemory * 1.5) {
            LogManager.warning(`Worker ${maxMemoryWorker.id} is using ${maxMemoryWorker.memory.toFixed(2)}MB memory, which is ${((maxMemoryWorker.memory / avgMemory) * 100).toFixed(0)}% of the average`);
        }
    }

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        LogManager.info('Received SIGTERM signal, shutting down gracefully...');

        // Notify all workers to finish and exit
        for (const worker of workers) {
            worker.send('shutdown');

            // Set a timeout to force kill if graceful shutdown doesn't work
            setTimeout(() => {
                if (!worker.isDead()) {
                    LogManager.warning(`Force killing worker ${worker.process.pid}`);
                    worker.kill('SIGKILL');
                }
            }, 5000);
        }

        // Exit the master process after all workers have finished
        setInterval(() => {
            if (workers.size === 0) {
                LogManager.info('All workers shut down, exiting master process');
                process.exit(0);
            }
        }, 1000);

        // Force exit after timeout if something hangs
        setTimeout(() => {
            LogManager.error('Force exiting master after timeout');
            process.exit(1);
        }, 10000);
    });

    process.on('SIGINT', () => {
        process.emit('SIGTERM');
    });

} else {
    // Worker processes will run the actual server
    LogManager.info(`Worker ${process.pid} started`);

    // Listen for shutdown signal from master
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            LogManager.info(`Worker ${process.pid} received shutdown signal`);
            // The shutdown process itself is handled by server.js
            // We just need to pass along the signal
        } else if (msg && msg.type === 'stats:request') {
            // Handle stats requests from master
            if (msg.statsType === 'memory') {
                const memoryStats = process.memoryUsage();

                process.send({
                    type: 'stats:response',
                    statsType: 'memory',
                    stats: {
                        heapUsed: memoryStats.heapUsed / 1024 / 1024,  // Convert to MB
                        heapTotal: memoryStats.heapTotal / 1024 / 1024, // Convert to MB
                        rss: memoryStats.rss / 1024 / 1024,            // Convert to MB
                        pid: process.pid,
                        workerId: cluster.worker.id
                    }
                });
            }
        }
    });

    // Load the server script
    require('./server');
}