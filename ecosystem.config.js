module.exports = {
  apps: [{
    name: "unknown-server",
    script: "./dist/server.js",
    instances: "max",
    exec_mode: "cluster",
    watch: true,
    ignore_watch: ["node_modules", "logs", "tmp"],
    watch_options: {
      followSymlinks: false
    },
    max_memory_restart: "1G",
    
    env_production: {
      NODE_ENV: "production",
      PORT: 3000
    },
    
    env_development: {
      NODE_ENV: "development",
      PORT: 3000
    },
    
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "./logs/pm2-error.log",
    out_file: "./logs/pm2-out.log",
    merge_logs: true,
    
    min_uptime: "60s",
    max_restarts: 10,
    restart_delay: 3000,
    
    exp_backoff_restart_delay: 100,
    
    kill_timeout: 5000,
    
    autorestart: true,
    vizion: true,
    
    node_args: "--max-old-space-size=1024",
  }]
};