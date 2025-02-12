# Deployment Guide

## Prerequisites

- Node.js 16.x or higher
- NPM 7.x or higher
- PostgreSQL 13.x or higher (or your preferred database)
- Redis (optional, for caching)
- NGINX 1.18.0 or higher (for production deployment)

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

Just make sure your database connection settings are properly configured in the `.env` file.

## Security Configuration

1. Configure NGINX (See [NGINX Deployment Guide](./nginx-deployment.md))
   - Set up SSL/TLS with modern ciphers
   - Configure security headers:
     - HSTS
     - CSP
     - X-Frame-Options
     - X-Content-Type-Options
     - Permissions Policy
   - Enable rate limiting:
     - Global: 30 r/m
     - API: 5-10 r/m
     - Static: Unlimited
   - Set up connection limits:
     - 10 concurrent per IP
     - 32 keepalive connections
     - 100 keepalive requests

2. Multi-layer Cache Configuration
   - Proxy cache for static files (1 year)
   - API response caching (10 minutes)
   - Cache bypass for authenticated requests
   - Stale cache usage on errors

3. NGINX Performance Optimization
   - Worker process auto-scaling
   - Increased file descriptors
   - Efficient event processing
   - Buffer size optimization
   - Compression settings

2. Enable HTTPS through NGINX reverse proxy
3. Configure security headers in both NGINX and `server.js`
4. Set up multi-layer rate limiting:
   - NGINX level rate limiting
   - Application level rate limiting
5. Configure CORS properly
6. Set up file upload limits
7. Enable DDoS protection through NGINX

## Production Deployment

### Application Server
1. Install PM2:
   ```bash
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   ```

2. Configure NGINX:
   - Copy nginx.conf to /etc/nginx/sites-available/
   - Create symbolic link to sites-enabled
   - Test and reload NGINX

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
   - NGINX logs in `/var/log/nginx/`

2. Monitor metrics:
   - `/api/health` for basic health check
   - `/api/metrics` for detailed metrics (admin only)
   - NGINX metrics and status

3. Regular maintenance:
   - Check application logs
   - Monitor NGINX logs
   - Review auth analytics
   - Check SSL certificates
   - Update security configurations
   - Monitor proxy performance
   - Review rate limiting effectiveness

## Scaling

### Horizontal Scaling
1. Set up NGINX load balancer
2. Configure sticky sessions
3. Use Redis for session store
4. Scale WebSocket connections
5. Configure proxy caching

### Vertical Scaling
1. Optimize Node.js settings
2. Tune database configuration
3. Configure caching properly
4. Optimize NGINX worker processes

## Backup & Recovery

1. Database backups:
   - Set up regular database backups
   - Store backups in a secure location

2. Application data:
   - Back up uploads directory
   - Store logs externally
   - Save configuration files
   - Back up NGINX configuration

## Troubleshooting

Common issues and solutions:
1. Connection timeouts (check NGINX proxy_read_timeout)
2. Memory leaks (monitor Node.js and NGINX processes)
3. Session issues (verify proxy headers)
4. WebSocket problems (check NGINX WebSocket configuration)
5. SSL/TLS issues (verify certificate configuration)
6. Cache problems (check proxy cache settings)
7. Rate limiting issues (review both NGINX and application limits)

## Support

For additional support:
1. Check documentation
2. Review issues on GitHub
3. Contact maintainers
4. See NGINX configuration guide