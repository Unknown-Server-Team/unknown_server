# Unknown Server API Documentation - {version}

## Overview

This document provides comprehensive documentation for the {version} API endpoints of Unknown Server.

## Authentication

All authenticated endpoints require one of the following:
- Bearer token in the Authorization header
- Valid session cookie

### Authentication Methods

```http
Authorization: Bearer <token>
```
or
```http
Cookie: sessionId=<session-token>
```

## Versioning

Include the API version in the Accept-Version header:
```http
Accept-Version: {version}
```

## Common Response Codes

| Code | Description |
|------|-------------|
| 200  | Success |
| 201  | Created |
| 400  | Bad Request |
| 401  | Unauthorized |
| 403  | Forbidden |
| 404  | Not Found |
| 429  | Too Many Requests |
| 500  | Internal Server Error |

## Rate Limiting

All API endpoints are subject to rate limiting. Current limits:
- Authentication endpoints: 5 requests per 15 minutes
- Regular endpoints: 100 requests per minute
- File upload endpoints: 10 requests per hour

## Endpoints

### Authentication

#### POST /api/{version}/auth/login
Authenticate user and receive access token.

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
    "roles": ["string"]
  }
}
```

### User Management

#### GET /api/{version}/users
List users (requires admin role)

**Query Parameters:**
- page (number, default: 1): Page number
- limit (number, default: 10): Items per page

**Response:**
```json
{
  "users": [{
    "id": "string",
    "email": "string",
    "roles": ["string"],
    "created_at": "string"
  }],
  "pagination": {
    "total": "number",
    "pages": "number",
    "current": "number",
    "limit": "number"
  }
}
```

## Websocket Events

For real-time updates, connect to:
```
ws://server/api/{version}/ws
```

### Available Events

| Event | Description | Required Role |
|-------|-------------|---------------|
| auth:roleChange | Role updates | admin |
| user:online | User status | user |
| system:metrics | Performance metrics | admin |

## Error Handling

All error responses follow this format:
```json
{
  "error": "string",
  "code": "string",
  "details": "object",
  "timestamp": "string"
}
```

## Security Considerations

1. Always use HTTPS in production
2. Implement proper rate limiting
3. Use secure session settings
4. Validate all inputs
5. Handle errors gracefully

## SDK Examples

### JavaScript/Node.js
```javascript
const client = new UnknownClient({
  version: '{version}',
  token: 'your-token'
});

await client.users.list({
  page: 1,
  limit: 10
});
```

### Python
```python
client = UnknownClient(
    version='{version}',
    token='your-token'
)

users = client.users.list(
    page=1,
    limit=10
)