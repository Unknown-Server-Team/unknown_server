# Role and Permission System Documentation

## Overview
The Unknown Server uses role-based access control (RBAC). Users hold one or more roles, roles carry permissions, and routes are protected by role checks in `AuthManager.getAuthMiddleware`.

## Roles

### Default Roles
The roles below are created the first time the server starts against an empty database.

1. **admin** - Administrator with full system access
   - Holds every seeded permission
   - Required for user listing, user deletion and all role management endpoints
   - The last admin cannot lose the `admin` role

2. **moderator** - Moderator with limited administrative privileges
   - View, create and update users
   - View system information and logs

3. **user** - Regular user with basic access
   - Assigned to every newly registered account
   - View user and system information

### Role Hierarchy
The seeded hierarchy is `admin` > `moderator` > `user`. Role checks honour it, so a user holding `admin` also passes a `moderator` or `user` role check.

## Permissions

Each permission row has a `name`, `resource` and `action`. The seeded permissions and their default role assignments are:

| Name | Resource | Action | admin | moderator | user |
|------|----------|--------|-------|-----------|------|
| read | users | view | ✓ | ✓ | ✓ |
| write | users | create | ✓ | ✓ | |
| write | users | update | ✓ | ✓ | |
| write | users | delete | ✓ | | |
| read | system | view | ✓ | ✓ | ✓ |
| write | system | configure | ✓ | | |
| read | logs | view | ✓ | ✓ | |
| write | roles | manage | ✓ | | |

Permission checks (`PermissionManager.hasPermission`, `checkPermissions` and `createPermissionMiddleware`) compare against the permission `name` column only.

## API Endpoints

### Role Management
All role management endpoints require a verified account with the `admin` role; other authenticated users receive `403`.

- GET `/api/v1/auth/roles` - List all roles
- GET `/api/v1/auth/user/{userId}/roles` - Get a user's roles
- POST `/api/v1/auth/user/{userId}/roles/{roleName}` - Assign a role to a user (`201`, `409` if already assigned)
- DELETE `/api/v1/auth/user/{userId}/roles/{roleName}` - Remove a role from a user (`404` if not assigned, `409` when removing the last admin)

The CLI wraps these as `unknown auth roles --list`, `unknown auth roles --user <id>` and `unknown user role <id> <add|remove> <role>`.

### Permissions
There are no HTTP endpoints for listing or editing permissions. The current user's roles and permissions are returned by:

- GET `/api/v1/auth/me` - Current user with `roles` and `permissions`

Permissions are managed in code through `PermissionManager.assignPermissionToRole` and `PermissionManager.removePermissionFromRole`, or directly in the `permissions` and `role_permissions` tables.

## Security Considerations

### Role Assignment
- Only verified admins can assign or remove roles
- The `admin` role cannot be removed from the last admin
- Role assignments and removals are logged with the acting admin's ID

### Best Practices
1. Follow the principle of least privilege
2. Regularly audit role assignments
3. Use role combinations instead of creating new roles
4. Document custom roles and their purposes

## Implementation Example

```javascript
router.get('/sensitive-data',
    AuthManager.getAuthMiddleware({ requireVerified: true, roles: ['admin'] }),
    async (req, res) => {
        res.json({ ok: true });
    }
);

router.post('/moderate-content',
    AuthManager.getAuthMiddleware(),
    RoleManager.createRoleAndPermissionMiddleware(['moderator', 'admin'], ['write']),
    async (req, res) => {
        res.json({ ok: true });
    }
);
```

`createRoleAndPermissionMiddleware` expects `req.user`, so it must run after `getAuthMiddleware`.
