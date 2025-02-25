# Error Handling

## Error Response Format
All API errors follow a consistent format:

```json
{
  "error": true,
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": {
    // Additional error details (optional)
  }
}
```

## HTTP Status Codes
The API uses standard HTTP status codes:

| Status Code | Description |
|-------------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 400 | Bad Request - Invalid input parameters |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Permission denied |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource conflict |
| 422 | Unprocessable Entity - Validation error |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Server-side error |

## Common Error Codes

### Authentication Errors
- `AUTH_INVALID_CREDENTIALS`: Invalid username or password
- `AUTH_TOKEN_EXPIRED`: JWT token has expired
- `AUTH_TOKEN_INVALID`: JWT token is invalid
- `AUTH_SESSION_EXPIRED`: User session has expired

### Validation Errors
- `VALIDATION_ERROR`: Input validation failed
- `INVALID_PARAMETER`: One or more parameters are invalid
- `MISSING_PARAMETER`: Required parameter is missing

### Permission Errors
- `PERMISSION_DENIED`: User lacks required permission
- `ROLE_REQUIRED`: Operation requires specific role
- `INSUFFICIENT_SCOPE`: Token lacks required scope

### Resource Errors
- `RESOURCE_NOT_FOUND`: Requested resource not found
- `RESOURCE_ALREADY_EXISTS`: Resource already exists
- `RESOURCE_CONFLICT`: Resource conflict detected

### Rate Limiting Errors
- `RATE_LIMIT_EXCEEDED`: API rate limit exceeded
- `TOO_MANY_REQUESTS`: Too many requests from IP address

## Handling Errors
Best practices for handling API errors:

1. Always check the HTTP status code
2. Inspect the error code for specific handling
3. Present user-friendly error messages based on the returned message
4. Implement exponential backoff for rate limiting errors
5. Refresh authentication tokens when receiving AUTH_TOKEN_EXPIRED