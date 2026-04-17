export type QueryScalar = string | number | boolean | null | Date;
export type QueryValue = QueryScalar | QueryValue[];
export type QueryParams = QueryValue[];
export type RoleChangeAction = 'assign' | 'remove';

export interface CountRow {
    count: number;
}

export interface HierarchyRow {
    parent_role_id: number;
    child_role_id: number;
}

export interface UserRoleRow {
    user_id: number;
}

export interface RoleIdRow {
    id: number;
}

export interface RoleNameRow {
    name: string;
}

export interface ParentRoleSummary {
    id: number;
    name: string;
}

export interface HierarchyRoleRow {
    id: number;
    name: string;
    description: string;
    parent_id: number | null;
    parent_name: string | null;
}

export interface InsertResult {
    insertId: number;
}

export interface RoleHierarchyData {
    id: number;
    name: string;
    description: string;
    parents: ParentRoleSummary[];
}

export interface RoleUpdateData {
    name: string;
    description: string;
    permissions?: number[];
    parentRoleId?: number | null;
}

export interface AuditEventMetadata {
    timestamp: number;
    automated: boolean;
}

export interface AuditEvent {
    action_type: 'role_assigned' | 'role_removed';
    target_id: number;
    role_id: number;
    metadata: AuditEventMetadata;
    admin_id: number;
}
