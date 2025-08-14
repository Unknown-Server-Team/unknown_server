import { 
    UserQueries, 
    RoleHierarchyQueries, 
    DatabaseQueries, 
    UserRecord, 
    RoleRecord, 
    RegistrationData 
} from '../types';

const db = require('./db');
const LogManager = require('../managers/LogManager');

async function initializeQueries(): Promise<void> {
    try {
        // Create users table
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                email_verified BOOLEAN DEFAULT FALSE,
                email_verification_token VARCHAR(255),
                email_verification_expires DATETIME,
                password_reset_token VARCHAR(255),
                password_reset_expires DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email),
                INDEX idx_email_verification (email_verification_token),
                INDEX idx_password_reset (password_reset_token)
            )
        `);

        // Create roles table
        await db.query(`
            CREATE TABLE IF NOT EXISTS roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL UNIQUE,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_role_name (name)
            )
        `);

        // Create roles_hierarchy table for role inheritance
        await db.query(`
            CREATE TABLE IF NOT EXISTS roles_hierarchy (
                parent_role_id INT NOT NULL,
                child_role_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (parent_role_id, child_role_id),
                FOREIGN KEY (parent_role_id) REFERENCES roles(id) ON DELETE CASCADE,
                FOREIGN KEY (child_role_id) REFERENCES roles(id) ON DELETE CASCADE,
                INDEX idx_parent_role (parent_role_id),
                INDEX idx_child_role (child_role_id)
            )
        `);

        // Create permissions table
        await db.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                resource VARCHAR(100) NOT NULL,
                action VARCHAR(100) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_permission (name, resource, action),
                INDEX idx_resource (resource),
                INDEX idx_action (action),
                INDEX idx_name (name)
            )
        `);

        // Create role_permissions table
        await db.query(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                role_id INT NOT NULL,
                permission_id INT NOT NULL,
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (role_id, permission_id),
                FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
                INDEX idx_role_permissions (role_id),
                INDEX idx_permission_roles (permission_id)
            )
        `);

        // Create user_roles table
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id INT NOT NULL,
                role_id INT NOT NULL,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, role_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                INDEX idx_user_roles (user_id),
                INDEX idx_role_users (role_id)
            )
        `);

        // Create sessions table for session management
        await db.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(128) NOT NULL PRIMARY KEY,
                user_id INT,
                data TEXT NOT NULL,
                expires DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_session_user (user_id),
                INDEX idx_session_expires (expires)
            )
        `);

        // Create rate_limiting table for tracking requests
        await db.query(`
            CREATE TABLE IF NOT EXISTS rate_limiting (
                id VARCHAR(255) NOT NULL PRIMARY KEY,
                requests INT NOT NULL DEFAULT 1,
                window_start DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_window_start (window_start)
            )
        `);

        // Create audit_logs table for security tracking
        await db.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                action VARCHAR(100) NOT NULL,
                resource VARCHAR(100) NOT NULL,
                resource_id VARCHAR(100),
                ip_address VARCHAR(45),
                user_agent TEXT,
                details JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                INDEX idx_audit_user (user_id),
                INDEX idx_audit_action (action),
                INDEX idx_audit_resource (resource),
                INDEX idx_audit_created (created_at)
            )
        `);

        // Initialize default roles if they don't exist
        LogManager.info('Initializing default roles and permissions...');
        
        // Check if roles already exist
        const existingRoles = await db.query('SELECT COUNT(*) as count FROM roles');
        const roleCount = existingRoles[0]?.count || 0;
        
        if (roleCount === 0) {
            // Create default roles
            const roles = [
                { name: 'admin', description: 'Administrator with full system access' },
                { name: 'moderator', description: 'Moderator with limited administrative privileges' },
                { name: 'user', description: 'Regular user with basic access' }
            ];

            const insertedRoles: { [key: string]: RoleRecord } = {};
            
            for (const role of roles) {
                const result = await db.query(
                    'INSERT INTO roles (name, description) VALUES (?, ?)',
                    [role.name, role.description]
                );
                
                // Get the inserted role for hierarchy setup
                const insertedRole = await db.query(
                    'SELECT * FROM roles WHERE id = ?',
                    [result.insertId]
                );
                insertedRoles[role.name] = insertedRole[0];
            }

            // Set up initial permissions
            const permissions = [
                { name: 'read', resource: 'users', action: 'view', description: 'View user information' },
                { name: 'write', resource: 'users', action: 'create', description: 'Create new users' },
                { name: 'write', resource: 'users', action: 'update', description: 'Update user information' },
                { name: 'write', resource: 'users', action: 'delete', description: 'Delete users' },
                { name: 'read', resource: 'system', action: 'view', description: 'View system information' },
                { name: 'write', resource: 'system', action: 'configure', description: 'Configure system settings' },
                { name: 'read', resource: 'logs', action: 'view', description: 'View system logs' },
                { name: 'write', resource: 'roles', action: 'manage', description: 'Manage user roles and permissions' }
            ];

            const insertedPermissions: { [key: string]: number } = {};
            
            for (const permission of permissions) {
                const result = await db.query(
                    'INSERT INTO permissions (name, resource, action, description) VALUES (?, ?, ?, ?)',
                    [permission.name, permission.resource, permission.action, permission.description]
                );
                insertedPermissions[`${permission.name}:${permission.resource}:${permission.action}`] = result.insertId;
            }

            // Assign permissions to roles
            const adminRole = insertedRoles['admin'];
            const moderatorRole = insertedRoles['moderator'];
            const userRole = insertedRoles['user'];

            // Admin gets all permissions
            for (const permissionId of Object.values(insertedPermissions)) {
                await db.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                    [adminRole.id, permissionId]
                );
            }

            // Moderator gets user management and read permissions
            const moderatorPermissions = [
                insertedPermissions['read:users:view'],
                insertedPermissions['write:users:create'],
                insertedPermissions['write:users:update'],
                insertedPermissions['read:system:view'],
                insertedPermissions['read:logs:view']
            ].filter(Boolean);

            for (const permissionId of moderatorPermissions) {
                await db.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                    [moderatorRole.id, permissionId]
                );
            }

            // User gets basic read permissions
            const userPermissions = [
                insertedPermissions['read:users:view'],
                insertedPermissions['read:system:view']
            ].filter(Boolean);

            for (const permissionId of userPermissions) {
                await db.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                    [userRole.id, permissionId]
                );
            }

            // Set up initial role hierarchy (admin > moderator > user)
            await db.query('DELETE FROM roles_hierarchy');
            
            // Admin is parent of moderator
            await db.query(
                'INSERT IGNORE INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                [adminRole.id, moderatorRole.id]
            );
            
            // Moderator is parent of user
            await db.query(
                'INSERT IGNORE INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
                [moderatorRole.id, userRole.id]
            );
        }

        LogManager.success('Database tables and initial data initialized');
    } catch (error) {
        LogManager.error('Failed to initialize database tables', error);
        throw error;
    }
}

// Add role hierarchy queries to use with RoleManager
const roleHierarchyQueries: RoleHierarchyQueries = {
    async getChildRoles(roleId: number): Promise<RoleRecord[]> {
        const roles = await db.query(
            `SELECT r.* FROM roles r
            JOIN roles_hierarchy rh ON r.id = rh.child_role_id
            WHERE rh.parent_role_id = ?`,
            [roleId]
        );
        return roles;
    },

    async getParentRoles(roleId: number): Promise<RoleRecord[]> {
        const roles = await db.query(
            `SELECT r.* FROM roles r
            JOIN roles_hierarchy rh ON r.id = rh.parent_role_id
            WHERE rh.child_role_id = ?`,
            [roleId]
        );
        return roles;
    },

    async addChildRole(parentRoleId: number, childRoleId: number): Promise<any> {
        // Check for circular references before adding
        const isCircular = await this.wouldCreateCircularReference(parentRoleId, childRoleId);
        if (isCircular) {
            throw new Error('Adding this role relationship would create a circular reference');
        }

        const result = await db.query(
            'INSERT IGNORE INTO roles_hierarchy (parent_role_id, child_role_id) VALUES (?, ?)',
            [parentRoleId, childRoleId]
        );
        return result;
    },

    async removeChildRole(parentRoleId: number, childRoleId: number): Promise<any> {
        const result = await db.query(
            'DELETE FROM roles_hierarchy WHERE parent_role_id = ? AND child_role_id = ?',
            [parentRoleId, childRoleId]
        );
        return result;
    },

    async wouldCreateCircularReference(parentRoleId: number, childRoleId: number): Promise<boolean> {
        // Check if childRoleId is already a parent of parentRoleId (direct or indirect)
        const checkCircular = async (currentRoleId: number, targetRoleId: number, visited: Set<number>): Promise<boolean> => {
            if (visited.has(currentRoleId)) {
                return true; // Circular reference detected
            }
            
            if (currentRoleId === targetRoleId) {
                return true; // Direct circular reference
            }
            
            visited.add(currentRoleId);
            
            const parentRoles = await this.getParentRoles(currentRoleId);
            
            for (const parentRole of parentRoles) {
                if (await checkCircular(parentRole.id, targetRoleId, new Set(visited))) {
                    return true;
                }
            }
            
            return false;
        };
        
        return checkCircular(childRoleId, parentRoleId, new Set());
    }
};

const userQueries: UserQueries = {
    async createUser(userData: RegistrationData): Promise<any> {
        const { email, password, name } = userData;
        const result = await db.query(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, password, name]
        );
        return result;
    },

    async getUserByEmail(email: string): Promise<UserRecord | undefined> {
        const users = await db.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        return users[0];
    },

    async getUserById(id: number): Promise<UserRecord | undefined> {
        const users = await db.query(
            'SELECT id, email, name, created_at FROM users WHERE id = ?',
            [id]
        );
        return users[0];
    },

    async getUserByEmailVerificationToken(token: string): Promise<UserRecord | undefined> {
        const users = await db.query(
            'SELECT * FROM users WHERE email_verification_token = ? AND email_verification_expires > NOW()',
            [token]
        );
        return users[0];
    },

    async getUserByPasswordResetToken(token: string): Promise<UserRecord | undefined> {
        const users = await db.query(
            'SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
            [token]
        );
        return users[0];
    },

    async setEmailVerificationToken(userId: number, token: string, expires: Date): Promise<any> {
        const result = await db.query(
            'UPDATE users SET email_verification_token = ?, email_verification_expires = ? WHERE id = ?',
            [token, expires, userId]
        );
        return result;
    },

    async setPasswordResetToken(userId: number, token: string, expires: Date): Promise<any> {
        const result = await db.query(
            'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
            [token, expires, userId]
        );
        return result;
    },

    async verifyEmail(userId: number): Promise<any> {
        const result = await db.query(
            'UPDATE users SET email_verified = TRUE, email_verification_token = NULL, email_verification_expires = NULL WHERE id = ?',
            [userId]
        );
        return result;
    },

    async updatePassword(userId: number, password: string): Promise<any> {
        const result = await db.query(
            'UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
            [password, userId]
        );
        return result;
    },

    async getUsers(offset: number = 0, limit: number = 10): Promise<UserRecord[]> {
        const users = await db.query(
            'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );
        return users;
    },

    async getUserCount(): Promise<number> {
        const result = await db.query('SELECT COUNT(*) as count FROM users');
        return result[0]?.count || 0;
    },

    async countUsersByRole(roleName: string): Promise<number> {
        const result = await db.query(`
            SELECT COUNT(DISTINCT ur.user_id) as count 
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE r.name = ?
        `, [roleName]);
        return result[0]?.count || 0;
    },

    async deleteUser(userId: number): Promise<boolean> {
        const result = await db.query(
            'DELETE FROM users WHERE id = ?',
            [userId]
        );
        return result.affectedRows > 0;
    }
};

const databaseQueries: DatabaseQueries = {
    initializeQueries,
    userQueries,
    roleHierarchyQueries
};

export = databaseQueries;