# Unknown Server

A modern Express.js server with built-in managers and utilities for rapid development.

## Features

- 🎨 Pretty Console Logging with file output
- 📊 Performance Monitoring (CPU, Memory, Response Times)
- 🔒 Rate Limiting with IP whitelist/blacklist
- 📡 WebSocket Support with rooms and heartbeat
- 🎯 Database Connection Pool
- 🔥 Hot Reloading for Development
- 🛡️ Security with Helmet and CORS
- 📦 Compression for better performance
- 🎭 EJS Templating with Layouts

## Quick Start

1. Clone the repository
2. Copy `.env.example` to `.env` and configure your settings
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Visit `http://localhost:3000`

## Project Structure

```
├── database/           # Database related files
│   ├── db.js          # Database connection pool
│   └── mainQueries.js # Main database queries
├── logs/              # Log files directory
├── managers/          # Core functionality managers
│   ├── LogManager.js
│   ├── PerformanceManager.js
│   ├── RatelimitManager.js
│   └── WebsocketManager.js
├── public/            # Static files
├── routers/           # Route handlers
│   ├── api/          # API routes
│   └── main/         # Web routes
└── views/             # EJS templates
    └── layouts/      # Layout templates
```

## Environment Variables

See `.env.example` for all available configuration options.

## Available Scripts

- `npm start`: Start the production server
- `npm run dev`: Start the development server with hot reloading
- `npm test`: Run tests (not implemented yet)

## Managers

### LogManager
- Pretty console logging with timestamps
- File logging with rotation
- Multiple log levels (DEBUG, INFO, WARN, ERROR)
- Custom gradient ASCII art support

### PerformanceManager
- CPU and Memory monitoring
- Response time tracking
- Endpoint performance metrics
- Automatic threshold warnings

### RatelimitManager
- Configurable rate limiting
- IP whitelist/blacklist
- Custom limiters for API and auth routes
- Offender tracking

### WebsocketManager
- Room support
- Heartbeat monitoring
- Middleware support
- Event system

## API Reference

### Health Check
```
GET /api/health
```
Returns server health metrics including uptime, memory usage, and CPU usage.

## License

MIT