# Scalability Guide

## Overview

This guide explains the scalability features of the Unknown Server and how to leverage them to handle increasing loads and improve performance in production environments.

## Key Scalability Features

### 1. Node.js Clustering Support

Unknown Server implements the Node.js clustering module to utilize all available CPU cores, significantly improving performance and request handling capacity.

#### How It Works

- `cluster.ts` (compiled to `dist/cluster.js`) is an alternative entry point that spawns one worker process per CPU core, or `SERVER_WORKERS` workers when set
- Each worker runs a complete instance of the Express application
- The master process manages worker lifecycle and handles failures
- Worker processes automatically restart if they crash

#### Usage

```bash
npm run cluster
SERVER_WORKERS=4 npm run cluster
```

### 2. Worker Thread Offloading

CPU-intensive operations are offloaded to dedicated worker threads, preventing them from blocking the main event loop.

#### Key Components

- **WorkerThreadManager**: Coordinates worker thread creation and management
- **Specialized Workers**:
  - `encryption.worker.js`: AES encryption and decryption, also used to verify legacy non-bcrypt password hashes
  - `dataProcessing.worker.js`: Processes and transforms data
  - `generic.worker.js`: Template for implementing custom workers

#### Benefits

- Non-blocking execution of CPU-intensive tasks
- Better responsiveness under heavy loads
- Improved resource utilization

#### Implementation Examples

```javascript
const result = await WorkerThreadManager.executeTask('encryption', {
    text: 'data-to-encrypt',
    key: 'encryption-key'
}, {
    operation: 'encrypt'
});

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
    script: "./dist/server.js",
    instances: "max",
    exec_mode: "cluster",
    watch: true,
    ignore_watch: ["node_modules", "logs", "tmp"],
    max_memory_restart: "1G"
  }]
};
```

`instances: "max"` starts one process per CPU core in PM2 cluster mode, and processes restart when they exceed 1GB of memory. The `start:pm2*` scripts build `dist/` first.

#### Usage

```bash
npm run start:pm2
npm run start:pm2:dev
npm run start:pm2:prod
npm run stop:pm2
npm run monitor
```

### 4. Authentication Workload

Passwords are hashed and verified with `bcryptjs` on the main thread using its asynchronous API, which yields to the event loop between rounds. Only legacy non-bcrypt hashes are verified through the encryption worker. Login and registration are additionally protected by strict rate limits.

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
   ```env
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

```typescript
import WorkerThreadManager from './managers/WorkerThreadManager';

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

For deployment and tuning guidance, refer to the [Deployment Guide](./deployment.md).