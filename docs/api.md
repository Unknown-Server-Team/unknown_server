# API Documentation

## Overview

This document provides an overview of the Unknown Server API endpoints and their usage. For interactive API documentation, visit `/api-docs` which provides Swagger UI documentation.

## Authentication

### POST /api/auth/login
Authenticates a user and creates a new session.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "string",
  "user": {
    "id": "string",
    "email": "string",
    "role": "string"
  }
}
```

### POST /api/auth/register
Registers a new user account.

**Request Body:**
```json
{
  "email": "string",
  "password": "string",
  "confirmPassword": "string"
}
```

### POST /api/auth/logout
Ends the current user session.

## User Management

### GET /api/users
Returns a paginated list of users.

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page

### GET /api/users/:id
Returns details for a specific user.

### DELETE /api/users/:id
Deletes a specific user account.

### GET /api/users/count
Returns the total number of users.

### GET /api/users/count-by-role
Returns user counts grouped by role.

## Authorization

The API implements role-based access control (RBAC) with the following features:

- Role-based route protection
- Permission-based access control
- Granular API endpoint security

### Roles
- Admin: Full system access
- User: Limited access to user-specific endpoints
- Guest: Public endpoint access only

### Headers
All authenticated requests must include:
```
Authorization: Bearer <token>
```

## Rate Limiting

API endpoints are protected by multi-layer rate limiting:

### Global Limits (NGINX Layer)
- 30 requests per minute per IP
- Burst allowance: 10 requests
- Maximum 10 concurrent connections per IP

### API-Specific Limits
- Auth endpoints: 5 requests per minute
- General API: 30 requests per minute
- Static resources: No rate limit

### Token Bucket Algorithm
- Dynamic token allocation
- Burst protection with configurable multiplier
- Automatic IP tracking and blocking
- Whitelist/blacklist support

### Rate Limits
- Auth endpoints: 5 requests per minute
- API endpoints: Dynamic based on user role
- Monitoring endpoints: Role-based access
- WebSocket connections: 60 per minute per IP

### Rate Limit Headers
```
X-RateLimit-Limit: Maximum requests allowed
X-RateLimit-Remaining: Requests remaining
X-RateLimit-Reset: Time until limit resets
```

### Cache Behavior
Different endpoints have different caching strategies:

1. Static Resources (/static/*):
   - Cache duration: 1 year
   - Cache-Control: public, no-transform
   - Cached at proxy level
   - Stale cache served on errors

2. API Endpoints (/api/*):
   - GET/HEAD methods cached for 10 minutes
   - No caching for authenticated requests
   - Cached at proxy level
   - Cache bypassed for WebSocket connections

3. Health Check (/health):
   - No caching
   - Internal access only
   - Rate limiting disabled

## Performance Monitoring

### GET /api/metrics
Returns detailed system performance metrics.

**Response:**
```json
{
  "cpu": {
    "usage": "number",
    "cores": ["number"],
    "average": "number"
  },
  "memory": {
    "heapUsed": "string",
    "heapTotal": "string",
    "rss": "string",
    "external": "string"
  },
  "requests": {
    "total": "number",
    "perMinute": "number",
    "avgResponseTime": "number"
  },
  "trends": {
    "responseTime": {
      "current": "number",
      "hourly": "number",
      "trend": "string"
    }
  }
}
```

### GET /api/health
Basic health check endpoint.

### GET /api/analytics/auth
Returns authentication-related analytics.

## WebSocket Events

Real-time events are available through WebSocket connections:
- Authentication events
- Session updates
- System notifications

## Error Responses

All API errors follow a standard format:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

Common HTTP status codes:
- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 429: Too Many Requests
- 500: Internal Server Error

## Security

The API implements several security measures through multiple layers:

### Application Layer
- Input sanitization
- CORS protection
- Content Security Policy (CSP)
- Secure session handling
- Advanced validation middleware

### Proxy Layer (NGINX)
- DDoS protection through rate limiting
- SSL/TLS termination with modern ciphers
- Request filtering and validation
- Advanced header security
- IP filtering and connection limiting
- Multi-layer caching strategy
- WebSocket protection
- Buffer overflow prevention

## Service Mesh Architecture

### Service Discovery
All services in the mesh are automatically discovered and monitored. Services must implement:
- Health check endpoint
- Version information
- Metrics collection

### Request Flow
1. Request arrives at gateway
2. Service mesh middleware intercepts
3. Load balancer selects endpoint
4. Request forwarded to service
5. Response cached if applicable
6. Metrics collected and updated

### Headers
The service mesh adds the following headers:
- `x-request-id`: Unique request identifier
- `x-service-version`: Version of the target service
- `x-proxy-timestamp`: Timestamp of proxy forwarding

## Gateway Features

### Circuit Breaker
- Timeout: 5000ms (default)
- Error Threshold: 50%
- Reset Timeout: 30000ms
- Volume Threshold: 10 requests

### Caching
- GET requests cached by default
- Cache TTL: 300s (configurable)
- Cache bypass for authenticated requests
- Automatic cache invalidation on errors

### Load Balancing
- Round-robin (default)
- Least connections
- Random selection
- Custom strategy support

For detailed security implementation, see:
- [Security Policy](../SECURITY.md)
- [NGINX Deployment Guide](./nginx-deployment.md)
- [Roles and Permissions](./roles-and-permissions.md)

## Additional Resources

- Interactive API Documentation: `/api-docs`
- Roles and Permissions: See `roles-and-permissions.md`
- Deployment Guide: See `deployment.md`