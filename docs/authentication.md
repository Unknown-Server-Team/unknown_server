# Authentication Guide

## Overview
This guide explains how authentication works in the Unknown Server API.

## Authentication Methods
The API supports multiple authentication methods:

### 1. JWT Authentication
The primary authentication method uses JSON Web Tokens (JWT).

#### Login
```
POST /api/v1/auth/login
```
Request body:
```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

#### Using JWT Tokens
Include the token in the Authorization header:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

### 2. Session Authentication
For web applications, session-based authentication is also supported.

#### Login
```
POST /api/v1/auth/session/login
```

#### Logout
```
POST /api/v1/auth/session/logout
```

## Token Refresh
To refresh an expiring token:
```
POST /api/v1/auth/refresh
```

Header:
```
Authorization: Bearer YOUR_CURRENT_TOKEN
```

## Password Reset
To request a password reset:
```
POST /api/v1/auth/password-reset
```

To complete a password reset:
```
POST /api/v1/auth/password-reset/complete
```

## Security Best Practices
1. Always use HTTPS
2. Store tokens securely (HttpOnly cookies for web apps)
3. Implement token refresh strategies
4. Use short expiration times for sensitive operations