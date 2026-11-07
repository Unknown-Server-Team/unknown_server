# Security Policy

## Supported Versions

See the version support table in the repository's [SECURITY.md](../SECURITY.md).

## Security Features

### Authentication & Authorization
- JWT authentication with configurable lifetime (`JWT_EXPIRATION`)
- bcrypt password hashing and password complexity rules
- Email verification and password reset flows
- Role-based access control with a role hierarchy (`admin` > `moderator` > `user`)
- Permission checks through `PermissionManager`
- Protection against removing the `admin` role from the last admin
- Session tracking and authentication analytics

### Rate Limiting & Abuse Protection
- Token bucket and sliding window rate limiting per IP
- Strict limits on login, registration and password reset
- Burst detection
- In-memory IP whitelist and blacklist, with automatic blacklisting of flooding IPs

### Monitoring
- Request, response time, CPU and memory metrics at `/api/metrics`
- Login attempt tracking and authentication analytics
- Log rotation with configurable retention

### Input & Data Security
- Request validation middleware for bodies, query strings and IDs
- Parameterized SQL queries
- Upload size limit of 50MB per file
- Password hashes are never returned by the API

### HTTP Security
- Helmet security headers, including a Content Security Policy, HSTS and `X-Content-Type-Options: nosniff`
- Configurable CORS origins (`CORS_ORIGIN`)
- NGINX reverse proxy with HTTP to HTTPS redirect and TLS 1.2/1.3 only (see the [NGINX guide](./nginx-deployment.md))

### Gateway and Service Mesh
- Circuit breakers around gateway services
- Health checks with automatic recovery
- Retries for idempotent proxied requests

## Best Practices

### Configuration
- Use a long, random `JWT_SECRET`
- Enable HTTPS in production
- Set `CORS_ORIGIN` to the exact origins you serve
- Restrict `/api/metrics` at the proxy
- Keep `CLI_API_KEY` unset unless you need CLI role assignment during registration

### Development
- Keep dependencies updated and `npm audit` clean
- Validate all inputs
- Use parameterized queries
- Validate file uploads

### Deployment
- Use environment variables for secrets
- Set up log retention
- Monitor auth analytics
- Run regular security audits
- Keep backups secure

## Reporting a Vulnerability

1. **Do Not** open public issues for security vulnerabilities
2. Email unknown.server.team@gmail.com with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- Confirmation within 24 hours
- Initial assessment within 72 hours
- Regular updates on progress
- Fix implementation timeline based on severity:
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 60 days

## Security Measures

### Authentication
- Password complexity requirements
- Email verification
- Token-based authentication
- Rate limiting on auth endpoints

### Authorization
- Role-based access control
- Permission-based access control
- Protection of admin privileges
- Token validation

### Data Protection
- Input validation
- SQL injection prevention through parameterized queries
- Content Security Policy against XSS
- Bearer tokens instead of cookies for API authentication, which avoids CSRF on the API

### Monitoring
- Auth analytics
- Session monitoring
- Suspicious activity detection
- Role change tracking
- Login attempt monitoring