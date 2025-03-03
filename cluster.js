/**
 * Cluster Manager for Unknown Server
 * 
 * This script enables the server to utilize all available CPU cores by creating
 * worker processes through Node.js cluster module. This significantly improves
 * performance and request handling capacity.
 * 
 * In production, this should be the main entry point rather than server.js directly.
 */

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
        }
    });
    
    // Add some basic stats logging
    setInterval(() => {
        const numWorkers = Object.keys(cluster.workers).length;
        LogManager.debug(`Active workers: ${numWorkers}`);
    }, 30000);
    
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
        }
    });
    
    // Load the server script
    require('./server');
}