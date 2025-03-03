# Scalability Guide

## Overview

This guide explains the scalability features of the Unknown Server and how to leverage them to handle increasing loads and improve performance in production environments.

## Key Scalability Features

### 1. Node.js Clustering Support

Unknown Server implements the Node.js clustering module to utilize all available CPU cores, significantly improving performance and request handling capacity.

#### How It Works

- The `cluster.js` file serves as an alternative entry point that spawns worker processes equal to the number of CPU cores
- Each worker runs a complete instance of the Express application
- The master process manages worker lifecycle and handles failures
- Worker processes automatically restart if they crash

#### Usage

```bash
# Start server with clustering
npm run cluster

# Alternatively, specify the number of workers
SERVER_WORKERS=4 npm run cluster
```

### 2. Worker Thread Offloading

CPU-intensive operations are offloaded to dedicated worker threads, preventing them from blocking the main event loop.

#### Key Components

- **WorkerThreadManager**: Coordinates worker thread creation and management
- **Specialized Workers**:
  - `encryption.worker.js`: Handles password hashing/verification and other crypto operations
  - `dataProcessing.worker.js`: Processes and transforms data
  - `generic.worker.js`: Template for implementing custom workers

#### Benefits

- Non-blocking execution of CPU-intensive tasks
- Better responsiveness under heavy loads
- Improved resource utilization

#### Implementation Examples

```javascript
// Offload encryption to a worker thread
const result = await WorkerThreadManager.executeTask('encryption', {
    text: 'data-to-encrypt',
    key: 'encryption-key'
}, {
    operation: 'encrypt'
});

// Process data in a worker thread
const stats = await WorkerThreadManager.executeTask('dataProcessing', dataArray, {
    operation: 'calculateStatistics',
    metrics: ['avg', 'min', 'max']
});
```

### 3. PM2 Process Management

PM2 integration provides robust process management, monitoring, and automatic recovery.

#### Features

- **Zero-downtime Reloads**: Update your application without downtime
- **Process Monitoring**: Track CPU/memory usage and performance metrics
- **Automatic Restarts**: Recover from crashes automatically
- **Load Balancing**: Distribute requests across multiple processes

#### Configuration

The `ecosystem.config.js` file contains the PM2 configuration:

```javascript
module.exports = {
  apps: [{
    name: "unknown-server",
    script: "./server.js",
    instances: "max",        // Use maximum number of CPU cores
    exec_mode: "cluster",    // Run in cluster mode for load balancing
    watch: false,            // Watch for file changes
    max_memory_restart: "1G" // Restart if memory exceeds 1GB
    // ... additional configuration ...
  }]
};
```

#### Usage

```bash
# Start with PM2
npm run start:pm2

# Start in development mode
npm run start:pm2:dev

# Start in production mode
npm run start:pm2:prod

# Stop all processes
npm run stop:pm2

# Monitor processes
npm run monitor
```

### 4. Non-blocking Authentication System

Authentication operations are CPU-intensive and can block the event loop. Unknown Server implements a non-blocking authentication system using worker threads.

#### Features

- Password hashing and verification offloaded to worker threads
- Continues to handle requests while processing authentication
- Scales better under high authentication loads
- Resistant to authentication-based DDoS attacks

## Best Practices for Scaling Unknown Server

### Development Environment

For development, the standard approach is sufficient:

```bash
npm run dev
```

### Production Environment

For production deployment with maximum performance:

1. Use PM2 with the provided configuration:
   ```bash
   npm run start:pm2:prod
   ```

2. Configure environment variables:
   ```
   NODE_ENV=production
   SERVER_WORKERS=[number-of-cores]
   MAX_WORKER_THREADS=[cores/2]
   ```

3. Set up proper monitoring:
   ```bash
   npm run monitor
   ```

### Handling High CPU Load

When your application needs to perform intensive CPU operations:

```javascript
// Import the WorkerThreadManager
const WorkerThreadManager = require('./managers/WorkerThreadManager');

// Offload the CPU-intensive task
const result = await WorkerThreadManager.executeTask(
  'taskType', 
  dataToProcess,
  options
);
```

### Monitoring Scalability Performance

Monitor your application's performance using:

1. PM2's built-in monitoring:
   ```bash
   npm run monitor
   ```

2. The WorkerThreadManager's statistics:
   ```javascript
   const stats = WorkerThreadManager.getStats();
   console.log(stats);
   ```

## Conclusion

By leveraging these scalability features, Unknown Server can handle significant load increases without sacrificing performance or reliability. The combination of clustering, worker threads, and process management provides a robust foundation for high-traffic applications.

For additional guidance on optimizing performance in specific scenarios, refer to the [Performance Tuning Guide](./performance-tuning.md) and [Deployment Guide](./deployment.md).