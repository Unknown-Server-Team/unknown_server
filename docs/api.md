# API Reference

## Authentication

### POST /api/auth/login
Login with credentials
```json
{
  "username": "string",
  "password": "string"
}
```

### POST /api/auth/register
Register new user
```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

### POST /api/auth/logout
Logout current session

### GET /api/auth/verify
Verify authentication status

## Sessions

### GET /api/sessions/current
Get current session info

### GET /api/sessions/all
Get all active sessions (admin only)

### DELETE /api/sessions/:id
Terminate specific session

## Users

### GET /api/users/profile
Get current user profile

### PATCH /api/users/profile
Update user profile

### GET /api/users
List users (admin only)

## Roles

### GET /api/roles
List available roles

### POST /api/roles
Create new role (admin only)

### PATCH /api/roles/:id
Update role (admin only)

## System

### GET /api/health
System health check
```json
{
  "status": "up",
  "uptime": "number",
  "memory": {
    "used": "number",
    "total": "number"
  },
  "cpu": "number"
}
```

### GET /api/metrics
System metrics (admin only)

## WebSocket Events

### Authentication Events
- `auth:login` - User login event
- `auth:logout` - User logout event
- `auth:failed` - Failed auth attempt

### Session Events
- `session:created` - New session created
- `session:expired` - Session expiration
- `session:terminated` - Session termination

### System Events
- `system:alert` - System alerts
- `system:metrics` - Real-time metrics
- `system:status` - Status updates