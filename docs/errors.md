# Error Handling

## Error Response Format
Every API error response contains an `error` field with a human-readable message. Some endpoints add more fields:

```json
{
  "success": false,
  "error": "Validation failed",
  "details": {
    "password": ["Password must contain at least one number"]
  }
}
```

- `success: false` is included by the users and role management endpoints
- `details` maps field names to lists of messages on validation failures; the password reset endpoint returns a plain list instead
- `retryAfter` (seconds) and a `Retry-After` header accompany rate limit responses
- `verificationRequired: true` accompanies `403` responses for accounts whose email is not verified
- `supportedVersions` accompanies `400` responses for an unsupported `Accept-Version` header

Unknown `/api` paths return `{ "error": true, "message": "Not Found", "status": 404 }`, and unhandled server errors return `{ "error": "Internal Server Error" }` with the underlying message added in development.

There are no machine-readable error codes; branch on the HTTP status code.

## HTTP Status Codes

| Status Code | Description |
|-------------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 400 | Bad Request - Invalid input or unsupported API version |
| 401 | Unauthorized - Missing or invalid token, or invalid credentials |
| 403 | Forbidden - Missing role, unverified email, or blocked IP |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Duplicate email, role already assigned, or last admin |
| 429 | Too Many Requests - Rate limit or burst limit exceeded |
| 500 | Internal Server Error - Server-side error |

## Handling Errors
Best practices for handling API errors:

1. Always check the HTTP status code
2. Show the `error` message, and the `details` entries when present
3. Honour `Retry-After` and back off exponentially on `429`
4. Log in again when a request returns `401` because the token expired
