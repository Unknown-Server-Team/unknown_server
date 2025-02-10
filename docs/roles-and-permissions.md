# Role and Permission System Documentation

## Overview
The Unknown Server implements a robust Role-Based Access Control (RBAC) system with granular permissions. This system allows for flexible access control and security management across the application.

## Roles

### Default Roles
1. **Admin**
   - Full system access
   - All permissions granted by default
   - Cannot remove the last admin user

2. **Moderator**
   - Content moderation access
   - Limited system management capabilities
   - Read-only access to most system features

3. **User**
   - Standard user access
   - Basic profile management
   - Limited to user-specific operations

## Permissions

### User Management
- `user:read` - View user information
- `user:write` - Create or modify user data
- `user:delete` - Delete user accounts

### Role Management
- `role:read` - View roles and their assignments
- `role:write` - Create or modify roles
- `role:delete` - Delete existing roles

### Permission Management
- `permission:read` - View permissions
- `permission:write` - Assign or remove permissions

### System Administration
- `system:admin` - Full system administration capabilities

## API Endpoints

### Role Management
- GET `/api/auth/roles` - List all roles
- GET `/api/auth/user/{userId}/roles` - Get user's roles
- POST `/api/auth/user/{userId}/roles/{roleId}` - Assign role to user
- DELETE `/api/auth/user/{userId}/roles/{roleId}` - Remove role from user

### Permission Management
- GET `/api/auth/permissions` - List all permissions
- GET `/api/auth/roles/{roleId}/permissions` - Get role's permissions
- POST `/api/auth/roles/{roleId}/permissions/{permissionId}` - Assign permission to role
- DELETE `/api/auth/roles/{roleId}/permissions/{permissionId}` - Remove permission from role
- GET `/api/auth/my-permissions` - Get current user's permissions

## Security Considerations

### Role Assignment
- Users must have appropriate permissions to assign roles
- Cannot remove the last admin role from the system
- Role changes are logged for security auditing

### Permission Management
- Only admins can manage permissions
- Critical system permissions cannot be removed from admin role
- Permission changes are tracked and monitored

### Best Practices
1. Follow the principle of least privilege
2. Regularly audit role assignments
3. Monitor permission usage through analytics
4. Use role combinations instead of creating new roles
5. Document custom roles and their purposes

## Implementation Example

```javascript
// Protect route with role requirement
router.get('/sensitive-data',
    AuthManager.getAuthMiddleware({ roles: ['admin'] }),
    async (req, res) => {
        // Only admins can access this route
    }
);

// Require both role and specific permissions
router.post('/moderate-content',
    RoleManager.createRoleAndPermissionMiddleware(
        ['moderator', 'admin'],
        ['content:write'],
        true // requireAll flag
    ),
    async (req, res) => {
        // Only moderators/admins with content:write permission can access
    }
);
```

## Monitoring and Analytics

The system provides built-in monitoring for:
- Role usage patterns
- Permission access frequency
- Failed permission attempts
- Role assignment changes

This data can be accessed through the auth analytics system for security auditing and system optimization.