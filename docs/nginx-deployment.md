# NGINX Deployment Guide

## Overview

This guide explains how to set up and configure NGINX as a reverse proxy for Unknown Server, including security features and optimizations.

## Prerequisites

- NGINX 1.18.0 or higher
- SSL certificate (Let's Encrypt recommended)
- Ubuntu 20.04 or higher (recommended OS)
- At least 1GB RAM for caching
- Minimum 2 CPU cores (recommended)

## Installation

1. Install NGINX:
```bash
sudo apt update
sudo apt install nginx
```

2. Create required directories:
```bash
# Create SSL directory
sudo mkdir -p /etc/nginx/ssl
# Create cache directory
sudo mkdir -p /tmp/nginx_cache
sudo chown www-data:www-data /tmp/nginx_cache
```

3. Copy configuration:
```bash
sudo cp /path/to/config/nginx.conf /etc/nginx/nginx.conf
sudo nginx -t
sudo systemctl restart nginx
```

## Performance Optimization

### Worker Settings
- `worker_processes auto`: Automatically detects CPU cores
- `worker_rlimit_nofile 65535`: Increases file descriptor limit
- `worker_connections 65535`: Maximum connections per worker
- `multi_accept on`: Accept as many connections as possible
- `use epoll`: Efficient event processing

### Buffer Configuration
- Client body buffer: 16KB
- Maximum body size: 50MB
- Header buffer: 1KB
- Large header buffers: 4x8KB

### Connection Tuning
- Keepalive: 32 connections
- Keepalive requests: 100 per connection
- Connection timeouts: 60 seconds
- Client timeouts: 12 seconds

## Security Features

### SSL/TLS Configuration
- TLS 1.2 and 1.3 only
- Modern cipher suite
- Perfect Forward Secrecy
- SSL session cache: 50MB
- Session tickets disabled
- OCSP stapling enabled

### Security Headers
- Strict Transport Security (HSTS)
- X-Frame-Options (DENY)
- X-Content-Type-Options (nosniff)
- X-XSS-Protection
- Content-Security-Policy
- Referrer Policy
- Permissions Policy

### Rate Limiting
- Global: 30 requests per minute
- Burst: 10 requests
- Connection limit: 10 per IP
- API-specific limits
- Static file optimizations

## Caching Strategy

### Main Cache Configuration
- Path: /tmp/nginx_cache
- Zone Size: 10MB
- Maximum Size: 10GB
- Inactive timeout: 60 minutes
- Levels: 1:2 (two-level directory hierarchy)

### Cache Rules
1. Static Files (/static/):
   - Cache time: 1 year
   - Cache-Control: public
   - Aggressive caching
   - Stale cache usage on errors

2. API Responses (/api/):
   - Cache time: 10 minutes
   - Only cache GET/HEAD methods
   - Skip cache for authenticated users
   - Background updates enabled

3. Dynamic Content:
   - Selective caching
   - Stale cache usage
   - Cache bypass for WebSocket

## Monitoring

### Key Metrics
1. Performance:
   - Active connections
   - Request processing time
   - Cache hit/miss ratio
   - Worker utilization

2. Security:
   - Failed requests
   - Rate limit hits
   - SSL handshake failures
   - Invalid requests

### Log Configuration
```nginx
access_log /var/log/nginx/access.log combined buffer=512k flush=1m;
error_log /var/log/nginx/error.log warn;
```

## Troubleshooting

### Common Issues

1. 502 Bad Gateway:
   - Check Node.js server status
   - Verify upstream configuration
   - Check error logs
   - Validate port settings

2. SSL Problems:
   - Certificate paths correct
   - Proper permissions
   - Valid certificate
   - Supported protocols

3. Performance Issues:
   - Worker configuration
   - Buffer sizes
   - Cache settings
   - Connection limits

4. WebSocket Failures:
   - Upgrade headers
   - Timeouts
   - Connection settings
   - Proxy configuration

## Maintenance Tasks

### Daily
- Monitor error logs
- Check SSL certificate status
- Review cache usage
- Monitor rate limiting

### Weekly
- Analyze access patterns
- Review security headers
- Check for NGINX updates
- Rotate logs

### Monthly
- Full security audit
- Performance optimization
- SSL configuration review
- Update documentation

## Best Practices

1. Security:
   - Regular updates
   - Audit configurations
   - Monitor logs
   - Review access patterns

2. Performance:
   - Optimize worker settings
   - Fine-tune cache
   - Monitor resources
   - Adjust rate limits

3. Maintenance:
   - Regular backups
   - Log rotation
   - SSL renewal
   - Configuration versioning

## Additional Resources

- [NGINX Documentation](https://nginx.org/en/docs/)
- [Security Policy](../SECURITY.md)
- [Deployment Guide](./deployment.md)
- [SSL Configuration Generator](https://ssl-config.mozilla.org/)