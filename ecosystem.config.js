/**
 * PM2 Configuration File
 * 
 * This file configures PM2 process manager, which provides:
 * - Process monitoring and automatic restart on failure
 * - Load balancing across multiple processes
 * - Log management and rotation
 * - Memory/CPU monitoring and limiting
 * - Zero-downtime reloads
 * 
 * Run with: pm2 start ecosystem.config.js
 */

module.exports = {
  apps: [{
    name: "unknown-server",
    script: "./server.js",
    instances: "max",        // Use maximum number of CPU cores
    exec_mode: "cluster",    // Run in cluster mode for load balancing
    watch: true,            // Watch for file changes
    ignore_watch: ["node_modules", "logs"], // Ignore certain directories
    watch_options: {
      followSymlinks: false
    },
    max_memory_restart: "1G", // Restart if memory exceeds 1GB
    
    // Environment variables for production
    env_production: {
      NODE_ENV: "production",
      PORT: 3000
    },
    
    // Environment variables for development
    env_development: {
      NODE_ENV: "development",
      PORT: 3000
    },
    
    // Log configuration
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "./logs/pm2-error.log",
    out_file: "./logs/pm2-out.log",
    merge_logs: true,
    
    // Restart strategy
    min_uptime: "60s",      // Consider process as stable after 60s
    max_restarts: 10,       // Number of consecutive unstable restarts before giving up
    restart_delay: 3000,    // Delay between automatic restarts
    
    // Health checks
    exp_backoff_restart_delay: 100, // Initial delay before restarting
    
    // Graceful shutdown
    kill_timeout: 5000,     // Wait time before forcing kill (ms)
    
    // Status monitoring
    autorestart: true,       // Auto restart if app crashes
    vizion: true,           // Enable versioning control
    
    // Advanced settings
    node_args: "--max-old-space-size=1024", // Increase heap memory limit
  }]
};