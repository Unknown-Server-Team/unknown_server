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

API endpoints are protected by rate limiting. Exceeding the rate limit will result in a 429 Too Many Requests response.

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

The API implements several security measures:
- Input sanitization
- CORS protection
- Content Security Policy (CSP)
- Secure session handling
- Advanced validation middleware

## Additional Resources

- Interactive API Documentation: `/api-docs`
- Roles and Permissions: See `roles-and-permissions.md`
- Deployment Guide: See `deployment.md`