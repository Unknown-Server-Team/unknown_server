# Deployment Guide

## Prerequisites

- Node.js 16.x or higher
- NPM 7.x or higher
- PostgreSQL 13.x or higher (or your preferred database)
- Redis (optional, for caching)

## Environment Setup

1. Clone the repository
2. Copy `.env.example` to `.env`
3. Configure environment variables:
   ```
   NODE_ENV=production
   PORT=3000
   DB_HOST=your-db-host
   DB_PORT=5432
   DB_NAME=your-db-name
   DB_USER=your-db-user
   DB_PASSWORD=your-db-password
   SESSION_SECRET=your-secure-session-secret
   CORS_ORIGIN=https://your-domain.com
   ```

## Installation

1. Install dependencies:
   ```bash
   npm install --production
   ```

2. Build assets (if needed):
   ```bash
   npm run build
   ```

## Database Setup

The database tables are automatically created when the application starts up. There's no need to run separate migration commands. The initialization process will:

1. Create the required database tables if they don't exist
2. Set up necessary indexes
3. Initialize default roles and permissions
4. Set up initial role permissions

Just make sure your database connection settings are properly configured in the `.env` file:
```
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=your-db-name
DB_USER=your-db-user
DB_PASSWORD=your-db-password
```

## Security Configuration

1. Enable HTTPS
2. Configure security headers in `server.js`
3. Set up rate limiting rules
4. Configure CORS properly
5. Set up file upload limits

## Production Deployment

### Using PM2
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

### Using Docker
```bash
docker build -t unknown-server .
docker run -p 3000:3000 unknown-server
```

### Using Docker Compose
```bash
docker-compose up -d
```

## Monitoring & Maintenance

1. Set up logging:
   - Application logs in `/logs/application-*.log`
   - Error logs in `/logs/error-*.log`

2. Monitor metrics:
   - `/api/health` for basic health check
   - `/api/metrics` for detailed metrics (admin only)

3. Regular maintenance:
   - Check logs for errors
   - Monitor auth analytics
   - Review session data
   - Update dependencies

## Scaling

### Horizontal Scaling
1. Set up load balancer
2. Configure sticky sessions
3. Use Redis for session store
4. Scale WebSocket connections

### Vertical Scaling
1. Optimize Node.js settings
2. Tune database configuration
3. Configure caching properly

## Backup & Recovery

1. Database backups:
   - Set up regular database backups using your database's native backup tools
   - For PostgreSQL, use pg_dump
   - For MySQL, use mysqldump
   - Store backups in a secure, external location

2. Application data:
   - Back up uploads directory
   - Store logs externally
   - Save configuration

## Troubleshooting

Common issues and solutions:
1. Connection timeouts
2. Memory leaks
3. Session issues
4. WebSocket problems

## Support

For additional support:
1. Check documentation
2. Review issues on GitHub
3. Contact maintainers