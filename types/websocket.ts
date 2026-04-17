import type WebSocket from 'ws';
import type { PermissionRecord, RoleRecord, UserData } from './index';

export interface ConnectedUser extends UserData {
    roles?: RoleRecord[];
}

export interface ExtendedWebSocket extends WebSocket {
    id: string;
    isAlive: boolean;
    rooms: Set<string>;
    user?: ConnectedUser;
    permissions?: string[];
}

export interface WebSocketInitOptions {
    isClusterWorker?: boolean;
    workerId?: string | number;
}

export interface WebSocketMessage {
    type: string;
    event?: string;
    data?: unknown;
    room?: string;
    token?: string;
}

export interface ClusterMessage {
    type: string;
    action: string;
    data?: unknown;
    room?: string;
    excludeId?: string | null;
    sourceWorkerId?: string | number | null;
}

export interface RoleChangeData {
    userId: number;
    roles: RoleRecord[];
}

export interface PermissionChangeData {
    roleId: number;
    permissions: PermissionRecord[];
}

export interface MonitoringPayload {
    type: 'monitoring:update';
    data: {
        auth: unknown;
        sessions: unknown;
        connections: number;
        rooms: Record<string, number>;
    };
}

export interface SecurityEventPayload {
    type: 'security:alert';
    eventType: string;
    data: unknown;
    timestamp: Date;
}

export interface RoomPayload {
    type: string;
    data: unknown;
}

export interface ConnectionPayload {
    type: 'connection';
    message: string;
    workerId: string | number | null;
    connectionId: string;
}

export interface ErrorPayload {
    type: 'error';
    message: string;
}

export interface SystemNotificationPayload {
    type: 'system:notification';
    data: {
        title: string;
        message: string;
        level: string;
        timestamp: Date;
    };
}

export interface SessionMetadata {
    ip: string | undefined;
    userAgent: string | string[] | undefined;
    workerId: string | number | null;
}

export type WebSocketEventHandler = (ws: ExtendedWebSocket, data: unknown) => Promise<void> | void;
export type MiddlewareHandler = (ws: ExtendedWebSocket, req: import('http').IncomingMessage) => boolean;

export interface PermissionManagerWsModule {
    hasPermission(userId: number, permissionName: string): Promise<boolean>;
    getUserPermissions(userId: number): Promise<PermissionRecord[]>;
}

export interface AuthMonitorWsModule {
    getMetrics(): unknown;
}

export interface SessionMonitorWsModule {
    trackSession(userId: number, sessionId: string, metadata: SessionMetadata): void;
    removeSession(userId: number, sessionId: string): void;
    getSessionStats(): unknown;
}

export interface CryptoModule {
    randomBytes(size: number): { toString(encoding: 'hex'): string };
}

export interface AuthManagerWsModule {
    verifyToken(token: string): Promise<UserData | null | undefined>;
}
