# Deployment Guide

## Prerequisites

- Node.js 20.x or higher
- NPM 8.x or higher
- MySQL 5.7+ or MariaDB 10.3+
- Redis (optional; an in-memory cache is used when it is not configured)
- NGINX 1.18.0 or higher (for production deployment)

## Environment Setup

1. Clone the repository
2. Copy `.env.example` to `.env`; it lists every variable the server reads
3. Configure at least the mandatory variables:
   ```env
   NODE_ENV=production
   PORT=3000
   APP_URL=https://your-domain.com
   DB_HOST=your-db-host
   DB_PORT=3306
   DB_NAME=your-db-name
   DB_USER=your-db-user
   DB_PASSWORD=your-db-password
   JWT_SECRET=a-long-random-secret
   CORS_ORIGIN=https://your-domain.com
   ```

The server logs a warning at startup when any of `DB_HOST`, `DB_USER`, `DB_NAME`, `JWT_SECRET` or `APP_URL` is missing.

## Installation

1. Install dependencies (TypeScript is needed for the build step):
   ```bash
   npm install
   ```

2. Compile the TypeScript sources into `dist/`:
   ```bash
   npm run build
   ```

## Database Setup

The database tables are automatically created when the application starts up. There's no need to run separate migration commands. The initialization process will:

1. Create the required database tables if they don't exist
2. Set up necessary indexes
3. Initialize default roles and permissions
4. Set up initial role permissions

The database and its user must exist beforehand; just make sure the connection settings in `.env` are correct. The `mysql` driver does not support MySQL 8's default `caching_sha2_password` plugin, so create the user with `mysql_native_password` on MySQL 8.

## Security Configuration

1. Put the server behind NGINX for TLS termination (see the [NGINX Deployment Guide](./nginx-deployment.md))
2. Security headers are set by Helmet in `server.ts`
3. Application-level rate limiting is built in; add NGINX limits if you need proxy-level protection
4. Set `CORS_ORIGIN` to a comma-separated list of allowed origins
5. Uploads are limited to 50MB per file by the application
6. Set `CLI_API_KEY` only if you use the CLI to assign roles during registration

## Production Deployment

### Application Server
1. Install PM2 and start the server:
   ```bash
   npm install -g pm2
   npm run start:pm2:prod
   pm2 save
   ```

2. Configure NGINX:
   - Copy `config/nginx.conf` to `/etc/nginx/nginx.conf`
   - Test and reload NGINX

### Clustering Without PM2
```bash
npm run cluster
```

## Monitoring & Maintenance

1. Logging:
   - Set `LOG_TO_FILE=true` to write `logs/application-<date>.log` and `logs/error-<date>.log`
   - `LOG_RETENTION_DAYS` controls how long rotated files are kept
   - NGINX logs in `/var/log/nginx/`

2. Monitoring endpoints:
   - `/api/health` for a basic health check
   - `/api/metrics` for detailed performance metrics; it is unauthenticated, so restrict it at the proxy in production
   - `/api/v1/routes` lists the registered v1 routes

3. Regular maintenance:
   - Check application and NGINX logs
   - Review auth analytics
   - Check SSL certificates
   - Review rate limiting effectiveness

## Performance Monitoring

Warning thresholds are configured with:
```env
MEMORY_WARNING_THRESHOLD=85
HIGH_CPU_USAGE=80
SLOW_RESPONSE_TIME=1000
```

`MEMORY_WARNING_THRESHOLD` and `HIGH_CPU_USAGE` are percentages; `SLOW_RESPONSE_TIME` is in milliseconds.

## Rate Limiting

Rate limits are defined in code rather than environment variables:
- All `/api/v1` routes: 60 requests per minute per IP
- Login: 5 requests per 15 minutes per IP
- Registration and password reset: 3 requests per hour per IP
- Profile updates: 5 requests per 15 minutes per IP

The limiter also rejects request bursts and blocks IPs that look like a flood until the process restarts.

## Scaling

### Horizontal Scaling
1. Set up an NGINX load balancer
2. Configure sticky sessions for WebSocket clients
3. Configure Redis (`REDIS_URL` or `REDIS_HOST`) so cache entries are shared between instances

### Vertical Scaling
1. Set `SERVER_WORKERS` and `MAX_WORKER_THREADS`
2. Tune the database configuration
3. Optimize NGINX worker processes

## Backup & Recovery

1. Database backups:
   - Set up regular database backups
   - Store backups in a secure location

2. Application data:
   - Store logs externally
   - Save configuration files, including `.env`
   - Back up the NGINX configuration

## Troubleshooting

Common issues and solutions:
1. Connection timeouts (check NGINX `proxy_read_timeout`)
2. Memory growth (monitor the Node.js processes and `/api/metrics`)
3. Wrong client IPs in logs (verify the `X-Forwarded-For` proxy header)
4. WebSocket problems (check the NGINX upgrade headers)
5. SSL/TLS issues (verify the certificate configuration)
6. Unexpected 429 responses (review the application rate limits above)

## Service Mesh Configuration

### Service Registration
The server registers the `auth` and `users` gateway services on `/api/v1/auth` and `/api/v1/users`, and an `auth-service` mesh entry whose health is checked at `AUTH_SERVICE_URL` + `/api/v1/health`.

When `AUTH_SERVICE_URL` points at another server, requests to `/api/v1/auth` are proxied there with their method, path, query string, body and status code intact. When it is unset or points at this server, the mesh only tracks health and requests are handled locally.

`AUTH_SERVICE_URL` is the only mesh setting read from the environment. The other mesh defaults are set in `ServiceMeshManager`: health checks every 10 seconds, metrics every 5 seconds, and 3 retry attempts for idempotent requests.

### Load Balancing Strategies
- round-robin (default)
- least-connections
- random
- weighted

Configure in the service registration:
```js
ServiceMeshManager.setupServiceProxy('service-name', {
  loadBalancingStrategy: 'round-robin'
});
```

### Metrics Collection
- Request count tracking
- Error rate monitoring
- Average response time
- Service status tracking

## Gateway Configuration

### Circuit Breaker Settings
Circuit breakers wrap each gateway service with these defaults from `GatewayManager`: 3 second timeout, opening at a 50% error rate after at least 10 requests, and a 30 second reset timeout. They are not configurable through environment variables.
