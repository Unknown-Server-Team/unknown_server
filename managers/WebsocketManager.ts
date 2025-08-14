import WebSocket from 'ws';
import { LogManager } from './LogManager';
import { permissionManager } from './PermissionManager';
import { authMonitor } from './AuthMonitor';
import { sessionMonitor } from './SessionMonitor';
import crypto from 'crypto';
import cluster from 'cluster';
import { Server } from 'http';
import { IncomingMessage } from 'http';

interface ExtendedWebSocket extends WebSocket {
    id: string;
    isAlive: boolean;
    rooms: Set<string>;
    user?: any;
    permissions?: string[];
}

interface WebSocketMessage {
    type: string;
    event?: string;
    data?: any;
    room?: string;
    token?: string;
}

interface ClusterMessage {
    type: string;
    action: string;
    data?: any;
    room?: string;
    excludeId?: string;
    sourceWorkerId?: string | number;
}

interface WebSocketInitOptions {
    isClusterWorker?: boolean;
    workerId?: string | number;
}

interface SystemNotification {
    type: string;
    data: {
        title: string;
        message: string;
        level: string;
        timestamp: Date;
    };
}

class WebsocketManager {
    private connections: Map<string, ExtendedWebSocket>;
    private events: Map<string, (ws: ExtendedWebSocket, data: any) => Promise<void> | void>;
    private rooms: Map<string, Set<string>>;
    private middlewares: Array<(ws: ExtendedWebSocket, req: IncomingMessage) => boolean>;
    private isClusterMode: boolean;
    private workerId: string | number | null;
    private wss?: WebSocket.Server;
    private monitoringRoom?: string;

    constructor() {
        this.connections = new Map(); // Change to Map for better lookup by ID
        this.events = new Map();
        this.rooms = new Map();
        this.middlewares = [];
        this.isClusterMode = false;
        this.workerId = null;
    }

    initialize(server: Server, options: WebSocketInitOptions = {}): void {
        // Check if we're in cluster mode
        this.isClusterMode = options.isClusterWorker || false;
        this.workerId = options.workerId || process.pid;
        
        this.wss = new WebSocket.Server({ 
            server,
            // In cluster mode, use client tracking to help with managing connections
            clientTracking: true 
        });
        
        this.wss.on('connection', (ws: ExtendedWebSocket, req: IncomingMessage) => {
            // Assign a unique ID to each connection that's consistent across the cluster
            ws.id = crypto.randomBytes(16).toString('hex');
            this.handleConnection(ws, req);
        });

        // In cluster mode, listen for messages from master process
        if (this.isClusterMode && process.on) {
            process.on('message', (message: ClusterMessage) => {
                if (message.type === 'websocket:broadcast') {
                    // Handle broadcasts from other workers
                    this.handleClusterBroadcast(message);
                }
            });
        }

        LogManager.info(`WebSocket server initialized${this.isClusterMode ? ` (worker ${this.workerId})` : ''}`);
    }

    // Handle broadcasts from other worker processes
    private handleClusterBroadcast(message: ClusterMessage): void {
        switch (message.action) {
            case 'broadcast':
                // Broadcast to all local connections
                this.localBroadcast(message.data);
                break;
            case 'room':
                // Broadcast to specific room
                if (message.room) {
                    this.localRoomBroadcast(message.room, message.data);
                }
                break;
            default:
                LogManager.warning('Unknown cluster websocket message type', { type: message.action });
        }
    }

    // Add auth event handling methods
    initializeAuthEvents(): void {
        // Auth events registration
        this.registerEvent('auth:roleChange', async (ws: ExtendedWebSocket, data: any) => {
            if (!this.verifyAuthority(ws, ['role:write'])) {
                return this.sendError(ws, 'Insufficient permissions');
            }
            
            this.broadcast({
                type: 'auth:roleUpdated',
                data: {
                    userId: data.userId,
                    roles: data.roles
                }
            });
        });

        this.registerEvent('auth:permissionChange', async (ws: ExtendedWebSocket, data: any) => {
            if (!this.verifyAuthority(ws, ['permission:write'])) {
                return this.sendError(ws, 'Insufficient permissions');
            }
            
            this.broadcast({
                type: 'auth:permissionUpdated',
                data: {
                    roleId: data.roleId,
                    permissions: data.permissions
                }
            });
        });
    }

    initializeMonitoringEvents(): void {
        // Create monitoring room
        this.monitoringRoom = 'system:monitoring';

        // Register monitoring events
        this.registerEvent('monitoring:subscribe', async (ws: ExtendedWebSocket, data: any) => {
            if (!ws.user || !await permissionManager.hasPermission(ws.user.id, 'system:admin')) {
                return this.sendError(ws, 'Insufficient permissions for monitoring');
            }
            this.joinRoom(ws, this.monitoringRoom!);
            this.sendMonitoringData(ws);
        });

        this.registerEvent('monitoring:unsubscribe', (ws: ExtendedWebSocket) => {
            this.leaveRoom(ws, this.monitoringRoom!);
        });

        // Set up periodic monitoring updates
        setInterval(() => {
            this.broadcastMonitoringData();
        }, 5000); // Every 5 seconds
    }

    private async sendMonitoringData(ws: ExtendedWebSocket): Promise<void> {
        const monitoringData = {
            type: 'monitoring:update',
            data: {
                auth: authMonitor.getMetrics(),
                sessions: sessionMonitor.getSessionStats(),
                connections: this.getConnections(),
                rooms: this.getRooms()
            }
        };
        ws.send(JSON.stringify(monitoringData));
    }

    private async broadcastMonitoringData(): Promise<void> {
        if (!this.monitoringRoom) return;
        
        const monitoringData = {
            type: 'monitoring:update',
            data: {
                auth: authMonitor.getMetrics(),
                sessions: sessionMonitor.getSessionStats(),
                connections: this.getConnections(),
                rooms: this.getRooms()
            }
        };
        this.broadcastToRoom(this.monitoringRoom, monitoringData);
    }

    notifySecurityEvent(eventType: string, data: any): void {
        if (!this.monitoringRoom) return;
        
        const securityEvent = {
            type: 'security:alert',
            eventType,
            data,
            timestamp: new Date()
        };
        this.broadcastToRoom(this.monitoringRoom, securityEvent);
    }

    private verifyAuthority(ws: ExtendedWebSocket, requiredPermissions: string[]): boolean {
        return !!(ws.user && ws.permissions && 
            requiredPermissions.some(perm => ws.permissions!.includes(perm)));
    }

    private sendError(ws: ExtendedWebSocket, message: string): void {
        ws.send(JSON.stringify({
            type: 'error',
            message
        }));
    }

    attachUserData(ws: ExtendedWebSocket, user: any, permissions: string[]): void {
        ws.user = user;
        ws.permissions = permissions;
        
        // Join user-specific room
        this.joinRoom(ws, `user:${user.id}`);
        
        // Join role-based rooms
        if (user.roles) {
            user.roles.forEach((role: any) => {
                this.joinRoom(ws, `role:${role.name}`);
            });
        }
    }

    notifyRoleUpdate(userId: number, roles: any[]): void {
        this.broadcastToRoom(`user:${userId}`, {
            type: 'auth:userRolesUpdated',
            data: { roles }
        });
    }

    notifyPermissionUpdate(roleId: number, permissions: any[]): void {
        // Notify all users with this role
        this.broadcast({
            type: 'auth:rolePermissionsUpdated',
            data: { roleId, permissions }
        });
    }

    private handleConnection(ws: ExtendedWebSocket, req: IncomingMessage): void {
        // Run through middlewares
        if (!this.runMiddlewares(ws, req)) {
            ws.close();
            return;
        }

        // Store connection in map using the unique ID as key
        this.connections.set(ws.id, ws);
        
        LogManager.info('New WebSocket connection', { 
            id: ws.id,
            ip: req.socket?.remoteAddress,
            totalConnections: this.connections.size,
            worker: this.workerId
        });

        ws.isAlive = true;
        ws.rooms = new Set();

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (data: WebSocket.Data) => {
            try {
                const message: WebSocketMessage = JSON.parse(data.toString());
                
                // Handle authentication on connection
                if (message.type === 'auth:authenticate') {
                    const { token } = message;
                    
                    // Need to dynamically require here to avoid circular dependency
                    const { authManager } = await import('./AuthManager');
                    const user = await authManager.verifyToken(token!);
                    
                    if (user) {
                        const permissions = await permissionManager.getUserPermissions(user.id);
                        this.attachUserData(ws, user, permissions.map(p => p.name));
                        ws.send(JSON.stringify({
                            type: 'auth:authenticated',
                            data: { user, permissions }
                        }));
                    }
                }

                await this.handleMessage(ws, message);
            } catch (error) {
                LogManager.error('Error handling WebSocket message', error);
                this.sendError(ws, 'Invalid message format');
            }
        });

        // Track connection in SessionMonitor
        if (ws.user) {
            sessionMonitor.trackSession(ws.user.id, ws.id, {
                ip: req.socket?.remoteAddress,
                userAgent: req.headers['user-agent'],
                workerId: this.workerId
            });
        }

        ws.on('close', () => {
            if (ws.user) {
                sessionMonitor.removeSession(ws.user.id, ws.id);
            }
            this.handleDisconnection(ws);
        });

        ws.on('error', (error: Error) => {
            LogManager.error('WebSocket error', error);
            this.handleDisconnection(ws);
        });

        // Send welcome message
        ws.send(JSON.stringify({ 
            type: 'connection', 
            message: 'Connected to WebSocket server',
            workerId: this.workerId,
            connectionId: ws.id
        }));
    }

    private handleDisconnection(ws: ExtendedWebSocket): void {
        // Remove from all rooms
        ws.rooms.forEach(room => {
            this.leaveRoom(ws, room);
        });

        this.connections.delete(ws.id);
        LogManager.info('Client disconnected', {
            connectionId: ws.id,
            remainingConnections: this.connections.size,
            worker: this.workerId
        });
    }

    private async handleMessage(ws: ExtendedWebSocket, message: WebSocketMessage): Promise<void> {
        const { type, event, data, room } = message;

        switch (type) {
            case 'event':
                if (event && this.events.has(event)) {
                    await this.events.get(event)!(ws, data);
                }
                break;
            case 'join':
                if (room) this.joinRoom(ws, room);
                break;
            case 'leave':
                if (room) this.leaveRoom(ws, room);
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

    use(middleware: (ws: ExtendedWebSocket, req: IncomingMessage) => boolean): void {
        this.middlewares.push(middleware);
        LogManager.info('Added new WebSocket middleware', {
            totalMiddlewares: this.middlewares.length
        });
    }

    private runMiddlewares(ws: ExtendedWebSocket, req: IncomingMessage): boolean {
        return this.middlewares.every(middleware => middleware(ws, req));
    }

    registerEvent(event: string, callback: (ws: ExtendedWebSocket, data: any) => Promise<void> | void): void {
        this.events.set(event, callback);
        LogManager.info('Registered WebSocket event', { event });
    }

    // Modified broadcast method to support cluster mode
    broadcast(data: any, exclude: ExtendedWebSocket | null = null): void {
        // Local broadcast
        this.localBroadcast(data, exclude);
        
        // In cluster mode, notify other workers
        if (this.isClusterMode && process.send) {
            process.send({
                type: 'websocket:broadcast',
                action: 'broadcast',
                data: data,
                excludeId: exclude ? exclude.id : null,
                sourceWorkerId: this.workerId
            });
        }
    }
    
    // Broadcast only to connections on this worker
    private localBroadcast(data: any, exclude: ExtendedWebSocket | null = null): void {
        const message = JSON.stringify(data);
        const excludeId = exclude ? exclude.id : null;
        
        for (const [id, client] of this.connections.entries()) {
            if (id !== excludeId && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    joinRoom(ws: ExtendedWebSocket, room: string): void {
        if (!this.rooms.has(room)) {
            this.rooms.set(room, new Set());
        }
        this.rooms.get(room)!.add(ws.id); // Store connection ID instead of object
        ws.rooms.add(room);
        LogManager.debug('Client joined room', { 
            connectionId: ws.id,
            room,
            clients: this.rooms.get(room)!.size,
            worker: this.workerId
        });
    }

    leaveRoom(ws: ExtendedWebSocket, room: string): void {
        if (this.rooms.has(room)) {
            this.rooms.get(room)!.delete(ws.id); // Delete by ID
            if (this.rooms.get(room)!.size === 0) {
                this.rooms.delete(room);
            }
        }
        ws.rooms.delete(room);
        LogManager.debug('Client left room', { 
            connectionId: ws.id,
            room,
            remainingClients: this.rooms.has(room) ? this.rooms.get(room)!.size : 0,
            worker: this.workerId
        });
    }

    broadcastToRoom(room: string, data: any, exclude: ExtendedWebSocket | null = null): void {
        // Local room broadcast
        this.localRoomBroadcast(room, data, exclude);
        
        // In cluster mode, notify other workers
        if (this.isClusterMode && process.send) {
            process.send({
                type: 'websocket:broadcast',
                action: 'room',
                room: room,
                data: data,
                excludeId: exclude ? exclude.id : null,
                sourceWorkerId: this.workerId
            });
        }
    }
    
    // Broadcast only to room members on this worker
    private localRoomBroadcast(room: string, data: any, exclude: ExtendedWebSocket | null = null): void {
        if (!this.rooms.has(room)) return;

        const message = JSON.stringify(data);
        const excludeId = exclude ? exclude.id : null;
        
        // Get connection IDs in this room
        const roomMembers = this.rooms.get(room)!;
        
        // Send to each connection
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

    // Add method to broadcast system notifications
    broadcastSystemNotification(title: string, message: string, level: string = 'info'): void {
        const notification: SystemNotification = {
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

export const websocketManager = new WebsocketManager();
export default websocketManager;