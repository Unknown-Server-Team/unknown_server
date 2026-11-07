# NGINX Deployment Guide

## Overview

This guide explains how to run NGINX as a TLS-terminating reverse proxy in front of Unknown Server using the configuration shipped in `config/nginx.conf`.

## Prerequisites

- NGINX 1.18.0 or higher
- An SSL certificate and key (Let's Encrypt recommended)
- Unknown Server listening on `127.0.0.1:3000`

## Installation

1. Install NGINX:
```bash
sudo apt update
sudo apt install nginx
```

2. Place the certificate where the config expects it (`ssl/` is resolved relative to the NGINX prefix, usually `/etc/nginx`):
```bash
sudo mkdir -p /etc/nginx/ssl
sudo cp your.crt /etc/nginx/ssl/nginx.crt
sudo cp your.key /etc/nginx/ssl/nginx.key
```

3. Copy the configuration, then edit `server_name` to your domain:
```bash
sudo cp config/nginx.conf /etc/nginx/nginx.conf
sudo nginx -t
sudo systemctl restart nginx
```

## What the Shipped Configuration Does

- Runs one worker process with 1024 connections
- Redirects all HTTP traffic on port 80 to HTTPS
- Terminates TLS on port 443 with TLS 1.2 and 1.3 only and a 1MB shared session cache
- Proxies every request to the `nodeapp` upstream at `127.0.0.1:3000` over HTTP/1.1
- Forwards `Upgrade`/`Connection` headers so WebSocket connections work
- Sets `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto` for the application

The application itself adds security headers through Helmet and applies its own rate limits, so these are not repeated in NGINX.

## Optional Hardening

The shipped configuration intentionally stays minimal. Common additions for production are:

- `worker_processes auto;` and a higher `worker_connections`
- `limit_req_zone` and `limit_conn_zone` for proxy-level rate and connection limits
- `client_max_body_size 50m;` to match the application's 50MB upload limit
- `proxy_cache_path` with caching for the static assets the app serves from `public/`
- `ssl_stapling on;` and an explicit modern `ssl_ciphers` list
- `add_header Strict-Transport-Security "max-age=31536000" always;`

## Logging

NGINX writes to its default access and error logs. To buffer access logging:
```nginx
access_log /var/log/nginx/access.log combined buffer=512k flush=1m;
error_log /var/log/nginx/error.log warn;
```

## Troubleshooting

1. 502 Bad Gateway:
   - Check that Unknown Server is running on port 3000
   - Verify the `nodeapp` upstream address
   - Check the NGINX error log

2. SSL problems:
   - Certificate and key paths are correct and readable by NGINX
   - Certificate is valid for the configured `server_name`

3. WebSocket failures:
   - `Upgrade` and `Connection` headers are forwarded
   - `proxy_http_version 1.1` is set

## Additional Resources

- [NGINX Documentation](https://nginx.org/en/docs/)
- [Security Policy](../SECURITY.md)
- [Deployment Guide](./deployment.md)
- [SSL Configuration Generator](https://ssl-config.mozilla.org/)
