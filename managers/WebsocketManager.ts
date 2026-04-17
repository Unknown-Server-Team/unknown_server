import WebSocket = require('ws');
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { PermissionRecord, RoleRecord } from '../types';
import type {
    ConnectedUser,
    ExtendedWebSocket,
    WebSocketInitOptions,
    WebSocketMessage,
    ClusterMessage,
    RoleChangeData,
    PermissionChangeData,
    MonitoringPayload,
    SecurityEventPayload,
    RoomPayload,
    ConnectionPayload,
    ErrorPayload,
    SystemNotificationPayload,
    WebSocketEventHandler,
    MiddlewareHandler,
    PermissionManagerWsModule,
    AuthMonitorWsModule,
    SessionMonitorWsModule,
    SessionMetadata,
    CryptoModule,
    AuthManagerWsModule
} from '../types/websocket';
import type { LogManagerModule } from '../types/modules';

const LogManager = require('./LogManager') as LogManagerModule;
const PermissionManager = require('./PermissionManager') as PermissionManagerWsModule;
const AuthMonitor = require('./AuthMonitor') as AuthMonitorWsModule;
const SessionMonitor = require('./SessionMonitor') as SessionMonitorWsModule;
const crypto = require('crypto') as CryptoModule;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isClusterMessage(value: unknown): value is ClusterMessage {
    return isRecord(value) && typeof value.type === 'string' && typeof value.action === 'string';
}

function parseWebSocketMessage(data: WebSocket.RawData): WebSocketMessage {
    const parsed = JSON.parse(data.toString()) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
        throw new Error('Invalid message format');
    }

    return {
        type: parsed.type,
        event: typeof parsed.event === 'string' ? parsed.event : undefined,
        data: parsed.data,
        room: typeof parsed.room === 'string' ? parsed.room : undefined,
        token: typeof parsed.token === 'string' ? parsed.token : undefined
    };
}

class WebsocketManager {
    private connections: Map<string, ExtendedWebSocket>;
    private events: Map<string, WebSocketEventHandler>;
    private rooms: Map<string, Set<string>>;
    private middlewares: MiddlewareHandler[];
    private isClusterMode: boolean;
    private workerId: string | number | null;
    private wss?: WebSocket.Server;
    private monitoringRoom?: string;

    constructor() {
        this.connections = new Map();
        this.events = new Map();
        this.rooms = new Map();
        this.middlewares = [];
        this.isClusterMode = false;
        this.workerId = null;
    }

    initialize(server: HttpServer, options: WebSocketInitOptions = {}): void {
        this.isClusterMode = options.isClusterWorker || false;
        this.workerId = options.workerId || process.pid;

        this.wss = new WebSocket.Server({
            server,
            clientTracking: true
        });

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            const socket = ws as ExtendedWebSocket;
            socket.id = crypto.randomBytes(16).toString('hex');
            this.handleConnection(socket, req);
        });

        if (this.isClusterMode) {
            process.on('message', (message: unknown) => {
                if (isClusterMessage(message) && message.type === 'websocket:broadcast') {
                    this.handleClusterBroadcast(message);
                }
            });
        }

        LogManager.success(`WebSocket server initialized${this.isClusterMode ? ` (worker ${this.workerId})` : ''}`);
    }

    handleClusterBroadcast(message: ClusterMessage): void {
        switch (message.action) {
            case 'broadcast':
                this.localBroadcast(message.data);
                break;
            case 'room':
                this.localRoomBroadcast(message.room || '', message.data);
                break;
            default:
                LogManager.warning('Unknown cluster websocket message type', { type: message.action });
        }
    }

    initializeAuthEvents(): void {
        this.registerEvent('auth:roleChange', async (ws: ExtendedWebSocket, data: unknown) => {
            if (!this.verifyAuthority(ws, ['role:write'])) {
                this.sendError(ws, 'Insufficient permissions');
                return;
            }

            if (!isRecord(data) || typeof data.userId !== 'number' || !Array.isArray(data.roles)) {
                this.sendError(ws, 'Invalid message format');
                return;
            }

            const payload: RoomPayload = {
                type: 'auth:roleUpdated',
                data: {
                    userId: data.userId,
                    roles: data.roles as RoleRecord[]
                } as RoleChangeData
            };
            this.broadcast(payload);
        });

        this.registerEvent('auth:permissionChange', async (ws: ExtendedWebSocket, data: unknown) => {
            if (!this.verifyAuthority(ws, ['permission:write'])) {
                this.sendError(ws, 'Insufficient permissions');
                return;
            }

            if (!isRecord(data) || typeof data.roleId !== 'number' || !Array.isArray(data.permissions)) {
                this.sendError(ws, 'Invalid message format');
                return;
            }

            const payload: RoomPayload = {
                type: 'auth:permissionUpdated',
                data: {
                    roleId: data.roleId,
                    permissions: data.permissions as PermissionRecord[]
                } as PermissionChangeData
            };
            this.broadcast(payload);
        });
    }

    initializeMonitoringEvents(): void {
        this.monitoringRoom = 'system:monitoring';

        this.registerEvent('monitoring:subscribe', async (ws: ExtendedWebSocket) => {
            if (!ws.user || !await PermissionManager.hasPermission(ws.user.id, 'system:admin')) {
                this.sendError(ws, 'Insufficient permissions for monitoring');
                return;
            }
            this.joinRoom(ws, this.monitoringRoom);
            await this.sendMonitoringData(ws);
        });

        this.registerEvent('monitoring:unsubscribe', (ws: ExtendedWebSocket) => {
            this.leaveRoom(ws, this.monitoringRoom || '');
        });

        setInterval(() => {
            void this.broadcastMonitoringData();
        }, 5000);
    }

    async sendMonitoringData(ws: ExtendedWebSocket): Promise<void> {
        const monitoringData: MonitoringPayload = {
            type: 'monitoring:update',
            data: {
                auth: AuthMonitor.getMetrics(),
                sessions: SessionMonitor.getSessionStats(),
                connections: this.getConnections(),
                rooms: this.getRooms()
            }
        };
        ws.send(JSON.stringify(monitoringData));
    }

    async broadcastMonitoringData(): Promise<void> {
        const monitoringData: MonitoringPayload = {
            type: 'monitoring:update',
            data: {
                auth: AuthMonitor.getMetrics(),
                sessions: SessionMonitor.getSessionStats(),
                connections: this.getConnections(),
                rooms: this.getRooms()
            }
        };
        this.broadcastToRoom(this.monitoringRoom || '', monitoringData);
    }

    notifySecurityEvent(eventType: string, data: unknown): void {
        const securityEvent: SecurityEventPayload = {
            type: 'security:alert',
            eventType,
            data,
            timestamp: new Date()
        };
        this.broadcastToRoom(this.monitoringRoom || '', securityEvent);
    }

    verifyAuthority(ws: ExtendedWebSocket, requiredPermissions: string[]): boolean {
        return Boolean(
            ws.user
            && ws.permissions
            && requiredPermissions.some((permission) => ws.permissions?.includes(permission))
        );
    }

    sendError(ws: ExtendedWebSocket, message: string): void {
        const payload: ErrorPayload = {
            type: 'error',
            message
        };
        ws.send(JSON.stringify(payload));
    }

    attachUserData(ws: ExtendedWebSocket, user: ConnectedUser, permissions: string[]): void {
        ws.user = user;
        ws.permissions = permissions;
        this.joinRoom(ws, `user:${user.id}`);

        if (user.roles) {
            user.roles.forEach((role) => {
                this.joinRoom(ws, `role:${role.name}`);
            });
        }
    }

    notifyRoleUpdate(userId: number, roles: RoleRecord[]): void {
        this.broadcastToRoom(`user:${userId}`, {
            type: 'auth:userRolesUpdated',
            data: { roles }
        });
    }

    notifyPermissionUpdate(roleId: number, permissions: PermissionRecord[]): void {
        this.broadcast({
            type: 'auth:rolePermissionsUpdated',
            data: { roleId, permissions }
        });
    }

    handleConnection(ws: ExtendedWebSocket, req: IncomingMessage): void {
        if (!this.runMiddlewares(ws, req)) {
            ws.close();
            return;
        }

        this.connections.set(ws.id, ws);

        LogManager.info('New WebSocket connection', {
            id: ws.id,
            ip: req.socket.remoteAddress,
            totalConnections: this.connections.size,
            worker: this.workerId
        });

        ws.isAlive = true;
        ws.rooms = new Set<string>();

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (data: WebSocket.RawData) => {
            try {
                const message = parseWebSocketMessage(data);

                if (message.type === 'auth:authenticate') {
                    const token = message.token;
                    if (token) {
                        const AuthManager = require('./AuthManager') as AuthManagerWsModule;
                        const user = await AuthManager.verifyToken(token);

                        if (user) {
                            const permissions = await PermissionManager.getUserPermissions(user.id);
                            this.attachUserData(ws, user as ConnectedUser, permissions.map((permission) => permission.name));
                            ws.send(JSON.stringify({
                                type: 'auth:authenticated',
                                data: { user, permissions }
                            }));
                        }
                    }
                }

                await this.handleMessage(ws, message);
            } catch (error: unknown) {
                LogManager.error('Error handling WebSocket message', error);
                this.sendError(ws, 'Invalid message format');
            }
        });

        if (ws.user) {
            const metadata: SessionMetadata = {
                ip: req.socket.remoteAddress,
                userAgent: req.headers['user-agent'],
                workerId: this.workerId
            };
            SessionMonitor.trackSession(ws.user.id, ws.id, metadata);
        }

        ws.on('close', () => {
            if (ws.user) {
                SessionMonitor.removeSession(ws.user.id, ws.id);
            }
            this.handleDisconnection(ws);
        });

        ws.on('error', (error: Error) => {
            LogManager.error('WebSocket error', error);
            this.handleDisconnection(ws);
        });

        const payload: ConnectionPayload = {
            type: 'connection',
            message: 'Connected to WebSocket server',
            workerId: this.workerId,
            connectionId: ws.id
        };
        ws.send(JSON.stringify(payload));
    }

    handleDisconnection(ws: ExtendedWebSocket): void {
        ws.rooms.forEach((room) => {
            this.leaveRoom(ws, room);
        });

        this.connections.delete(ws.id);
        LogManager.info('Client disconnected', {
            connectionId: ws.id,
            remainingConnections: this.connections.size,
            worker: this.workerId
        });
    }

    async handleMessage(ws: ExtendedWebSocket, message: WebSocketMessage): Promise<void> {
        const { type, event, data, room } = message;

        switch (type) {
            case 'event':
                if (event && this.events.has(event)) {
                    await this.events.get(event)?.(ws, data);
                }
                break;
            case 'join':
                if (room) {
                    this.joinRoom(ws, room);
                }
                break;
            case 'leave':
                if (room) {
                    this.leaveRoom(ws, room);
                }
                break;
            case 'broadcast':
                if (room) {
                    this.broadcastToRoom(room, data, ws);
                } else {
                    this.broadcast(data, ws);
                }
                break;
            default:
                ws.send(JSON.stringify({ error: 'Unknown message type' }));
        }
    }

    use(middleware: MiddlewareHandler): void {
        this.middlewares.push(middleware);
        LogManager.info('Added new WebSocket middleware', {
            totalMiddlewares: this.middlewares.length
        });
    }

    runMiddlewares(ws: ExtendedWebSocket, req: IncomingMessage): boolean {
        return this.middlewares.every((middleware) => middleware(ws, req));
    }

    registerEvent(event: string, callback: WebSocketEventHandler): void {
        this.events.set(event, callback);
        LogManager.info('Registered WebSocket event', { event });
    }

    broadcast(data: unknown, exclude: ExtendedWebSocket | null = null): void {
        this.localBroadcast(data, exclude);

        if (this.isClusterMode && process.send) {
            process.send({
                type: 'websocket:broadcast',
                action: 'broadcast',
                data,
                excludeId: exclude ? exclude.id : null,
                sourceWorkerId: this.workerId
            });
        }
    }

    localBroadcast(data: unknown, exclude: ExtendedWebSocket | null = null): void {
        const message = JSON.stringify(data);
        const excludeId = exclude ? exclude.id : null;

        for (const [id, client] of this.connections.entries()) {
            if (id !== excludeId && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    joinRoom(ws: ExtendedWebSocket, room: string | undefined): void {
        if (!room) return;
        if (!this.rooms.has(room)) {
            this.rooms.set(room, new Set<string>());
        }
        this.rooms.get(room)?.add(ws.id);
        ws.rooms.add(room);
        LogManager.debug('Client joined room', {
            connectionId: ws.id,
            room,
            clients: this.rooms.get(room)?.size || 0,
            worker: this.workerId
        });
    }

    leaveRoom(ws: ExtendedWebSocket, room: string): void {
        if (this.rooms.has(room)) {
            this.rooms.get(room)?.delete(ws.id);
            if ((this.rooms.get(room)?.size || 0) === 0) {
                this.rooms.delete(room);
            }
        }
        ws.rooms.delete(room);
        LogManager.debug('Client left room', {
            connectionId: ws.id,
            room,
            remainingClients: this.rooms.has(room) ? this.rooms.get(room)?.size || 0 : 0,
            worker: this.workerId
        });
    }

    broadcastToRoom(room: string, data: unknown, exclude: ExtendedWebSocket | null = null): void {
        this.localRoomBroadcast(room, data, exclude);

        if (this.isClusterMode && process.send) {
            process.send({
                type: 'websocket:broadcast',
                action: 'room',
                room,
                data,
                excludeId: exclude ? exclude.id : null,
                sourceWorkerId: this.workerId
            });
        }
    }

    localRoomBroadcast(room: string, data: unknown, exclude: ExtendedWebSocket | null = null): void {
        if (!this.rooms.has(room)) {
            return;
        }

        const message = JSON.stringify(data);
        const excludeId = exclude ? exclude.id : null;
        const roomMembers = this.rooms.get(room);

        if (!roomMembers) {
            return;
        }

        for (const id of roomMembers) {
            if (id !== excludeId) {
                const client = this.connections.get(id);
                if (client && client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            }
        }
    }

    getConnections(): number {
        return this.connections.size;
    }

    getRooms(): Record<string, number> {
        const roomStats: Record<string, number> = {};
        this.rooms.forEach((clients, room) => {
            roomStats[room] = clients.size;
        });
        return roomStats;
    }

    startHeartbeat(): void {
        const interval = setInterval(() => {
            for (const [id, ws] of this.connections.entries()) {
                if (ws.isAlive === false) {
                    LogManager.debug('Terminating inactive WebSocket connection', {
                        connectionId: id,
                        worker: this.workerId
                    });
                    ws.terminate();
                    continue;
                }
                ws.isAlive = false;
                ws.ping();
            }
        }, 30000);

        this.wss?.on('close', () => {
            clearInterval(interval);
        });

        LogManager.info('WebSocket heartbeat started', { worker: this.workerId });
    }

    close(): void {
        this.wss?.close(() => {
            LogManager.info('WebSocket server closed', {
                closedConnections: this.connections.size,
                worker: this.workerId
            });
        });
    }

    broadcastSystemNotification(title: string, message: string, level = 'info'): void {
        const notification: SystemNotificationPayload = {
            type: 'system:notification',
            data: {
                title,
                message,
                level,
                timestamp: new Date()
            }
        };
        this.broadcast(notification);
    }
}

type WebsocketManagerExport = WebsocketManager & {
    websocketManager: WebsocketManager;
    default: WebsocketManager;
};

const websocketManager = new WebsocketManager();
const exportedWebsocketManager = websocketManager as WebsocketManagerExport;
exportedWebsocketManager.websocketManager = websocketManager;
exportedWebsocketManager.default = websocketManager;

export = exportedWebsocketManager;
