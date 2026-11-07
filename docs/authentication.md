# Authentication Guide

## Overview
The Unknown Server API authenticates requests with JSON Web Tokens (JWT). Tokens are issued by the register and login endpoints and must be sent as a Bearer token on every protected request.

## Endpoints
All authentication endpoints live under `/api/v1/auth`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | Create an account and receive a token |
| POST | `/api/v1/auth/login` | No | Exchange email and password for a token |
| GET | `/api/v1/auth/me` | Bearer | Current user with roles and permissions |
| GET | `/api/v1/auth/verify-email/{token}` | No | Confirm an email address |
| POST | `/api/v1/auth/forgot-password` | No | Request a password reset email |
| POST | `/api/v1/auth/reset-password/{token}` | No | Set a new password with a reset token |

## Registration
```http
POST /api/v1/auth/register
Content-Type: application/json
```

Request body:
```json
{
  "email": "user@example.com",
  "password": "Str0ng!Password",
  "name": "Jane Doe"
}
```

Passwords need at least 8 characters with an uppercase letter, a lowercase letter, a digit and a special character. New accounts receive the `user` role. Requests carrying a valid `x-cli-api-key` header (matching `CLI_API_KEY`) may also pass a `roles` array.

Response (`201`, `409` if the email is taken):
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "Jane Doe",
    "email_verified": false
  }
}
```

A verification email is sent when SMTP is configured.

## Login
```http
POST /api/v1/auth/login
Content-Type: application/json
```

Request body:
```json
{
  "email": "user@example.com",
  "password": "Str0ng!Password"
}
```

Response (`401` on invalid credentials):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "Jane Doe",
    "email_verified": true
  },
  "expiresIn": 86400
}
```

The token lifetime is controlled by `JWT_EXPIRATION` (default `24h`). Login also sets an HttpOnly `sessionId` cookie used for session tracking; it is not accepted in place of the Bearer token.

## Using Tokens
Include the token in the Authorization header:
```http
Authorization: Bearer YOUR_TOKEN_HERE
```

Most protected endpoints also require a verified email address and respond with `403` and `"verificationRequired": true` otherwise. There is no refresh or logout endpoint; request a new token by logging in again.

## Current User
```http
GET /api/v1/auth/me
Authorization: Bearer YOUR_TOKEN_HERE
```

Returns `{ "user": {...}, "roles": [...], "permissions": [...] }`. This endpoint does not require a verified email.

## Email Verification
```http
GET /api/v1/auth/verify-email/{token}
```

## Password Reset
Request a reset email. The response is the same whether or not the address exists:
```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{"email": "user@example.com"}
```

Complete the reset with the token from the email:
```http
POST /api/v1/auth/reset-password/{token}
Content-Type: application/json

{"password": "N3w!Password"}
```

## Rate Limits
- Login: 5 requests per 15 minutes per IP
- Registration: 3 requests per hour per IP
- Forgot and reset password: 3 requests per hour per IP
- All `/api/v1` routes additionally share a limit of 60 requests per minute per IP

## Security Best Practices
1. Always use HTTPS
2. Store tokens securely and never put them in URLs
3. Keep `JWT_EXPIRATION` short for sensitive deployments
4. Use a long, random `JWT_SECRET`
