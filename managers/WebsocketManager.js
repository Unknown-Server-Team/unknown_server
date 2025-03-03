const WebSocket = require('ws');
const LogManager = require('./LogManager');
const PermissionManager = require('./PermissionManager');
const AuthMonitor = require('./AuthMonitor');
const SessionMonitor = require('./SessionMonitor');
const crypto = require('crypto');
const cluster = require('cluster');

class WebsocketManager {
    constructor() {
        this.connections = new Map(); // Change to Map for better lookup by ID
        this.events = new Map();
        this.rooms = new Map();
        this.middlewares = [];
        this.isClusterMode = false;
        this.workerId = null;
    }

    initialize(server, options = {}) {
        // Check if we're in cluster mode
        this.isClusterMode = options.isClusterWorker || false;
        this.workerId = options.workerId || process.pid;
        
        this.wss = new WebSocket.Server({ 
            server,
            // In cluster mode, use client tracking to help with managing connections
            clientTracking: true 
        });
        
        this.wss.on('connection', (ws, req) => {
            // Assign a unique ID to each connection that's consistent across the cluster
            ws.id = crypto.randomBytes(16).toString('hex');
            this.handleConnection(ws, req);
        });

        // In cluster mode, listen for messages from master process
        if (this.isClusterMode) {
            process.on('message', (message) => {
                if (message.type === 'websocket:broadcast') {
                    // Handle broadcasts from other workers
                    this.handleClusterBroadcast(message);
                }
            });
        }

        LogManager.success(`WebSocket server initialized${this.isClusterMode ? ` (worker ${this.workerId})` : ''}`);
    }

    // Handle broadcasts from other worker processes
    handleClusterBroadcast(message) {
        switch (message.action) {
            case 'broadcast':
                // Broadcast to all local connections
                this.localBroadcast(message.data);
                break;
            case 'room':
                // Broadcast to specific room
                this.localRoomBroadcast(message.room, message.data);
                break;
            default:
                LogManager.warning('Unknown cluster websocket message type', { type: message.action });
        }
    }

    // Add auth event handling methods
    initializeAuthEvents() {
        // Auth events registration
        this.registerEvent('auth:roleChange', async (ws, data) => {
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

        this.registerEvent('auth:permissionChange', async (ws, data) => {
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

    initializeMonitoringEvents() {
        // Create monitoring room
        this.monitoringRoom = 'system:monitoring';

        // Register monitoring events
        this.registerEvent('monitoring:subscribe', async (ws, data) => {
            if (!await PermissionManager.hasPermission(ws.user.id, 'system:admin')) {
                return this.sendError(ws, 'Insufficient permissions for monitoring');
            }
            this.joinRoom(ws, this.monitoringRoom);
            this.sendMonitoringData(ws);
        });

        this.registerEvent('monitoring:unsubscribe', (ws) => {
            this.leaveRoom(ws, this.monitoringRoom);
        });

        // Set up periodic monitoring updates
        setInterval(() => {
            this.broadcastMonitoringData();
        }, 5000); // Every 5 seconds
    }

    async sendMonitoringData(ws) {
        const monitoringData = {
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

    async broadcastMonitoringData() {
        const monitoringData = {
            type: 'monitoring:update',
            data: {
                auth: AuthMonitor.getMetrics(),
                sessions: SessionMonitor.getSessionStats(),
                connections: this.getConnections(),
                rooms: this.getRooms()
            }
        };
        this.broadcastToRoom(this.monitoringRoom, monitoringData);
    }

    notifySecurityEvent(eventType, data) {
        const securityEvent = {
            type: 'security:alert',
            eventType,
            data,
            timestamp: new Date()
        };
        this.broadcastToRoom(this.monitoringRoom, securityEvent);
    }

    verifyAuthority(ws, requiredPermissions) {
        return ws.user && ws.permissions && 
            requiredPermissions.some(perm => ws.permissions.includes(perm));
    }

    sendError(ws, message) {
        ws.send(JSON.stringify({
            type: 'error',
            message
        }));
    }

    attachUserData(ws, user, permissions) {
        ws.user = user;
        ws.permissions = permissions;
        
        // Join user-specific room
        this.joinRoom(ws, `user:${user.id}`);
        
        // Join role-based rooms
        if (user.roles) {
            user.roles.forEach(role => {
                this.joinRoom(ws, `role:${role.name}`);
            });
        }
    }

    notifyRoleUpdate(userId, roles) {
        this.broadcastToRoom(`user:${userId}`, {
            type: 'auth:userRolesUpdated',
            data: { roles }
        });
    }

    notifyPermissionUpdate(roleId, permissions) {
        // Notify all users with this role
        this.broadcast({
            type: 'auth:rolePermissionsUpdated',
            data: { roleId, permissions }
        });
    }

    handleConnection(ws, req) {
        // Run through middlewares
        if (!this.runMiddlewares(ws, req)) {
            ws.close();
            return;
        }

        // Store connection in map using the unique ID as key
        this.connections.set(ws.id, ws);
        
        LogManager.info('New WebSocket connection', { 
            id: ws.id,
            ip: req.socket.remoteAddress,
            totalConnections: this.connections.size,
            worker: this.workerId
        });

        ws.isAlive = true;
        ws.rooms = new Set();

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);
                
                // Handle authentication on connection
                if (message.type === 'auth:authenticate') {
                    const { token } = message;
                    
                    // Need to dynamically require here to avoid circular dependency
                    const AuthManager = require('./AuthManager');
                    const user = await AuthManager.verifyToken(token);
                    
                    if (user) {
                        const permissions = await PermissionManager.getUserPermissions(user.id);
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
            SessionMonitor.trackSession(ws.user.id, ws.id, {
                ip: req.socket.remoteAddress,
                userAgent: req.headers['user-agent'],
                workerId: this.workerId
            });
        }

        ws.on('close', () => {
            if (ws.user) {
                SessionMonitor.removeSession(ws.user.id, ws.id);
            }
            this.handleDisconnection(ws);
        });

        ws.on('error', (error) => {
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

    handleDisconnection(ws) {
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

    async handleMessage(ws, message) {
        const { type, event, data, room } = message;

        switch (type) {
            case 'event':
                if (this.events.has(event)) {
                    await this.events.get(event)(ws, data);
                }
                break;
            case 'join':
                this.joinRoom(ws, room);
                break;
            case 'leave':
                this.leaveRoom(ws, room);
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

    use(middleware) {
        this.middlewares.push(middleware);
        LogManager.info('Added new WebSocket middleware', {
            totalMiddlewares: this.middlewares.length
        });
    }

    runMiddlewares(ws, req) {
        return this.middlewares.every(middleware => middleware(ws, req));
    }

    registerEvent(event, callback) {
        this.events.set(event, callback);
        LogManager.info('Registered WebSocket event', { event });
    }

    // Modified broadcast method to support cluster mode
    broadcast(data, exclude = null) {
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
    localBroadcast(data, exclude = null) {
        const message = JSON.stringify(data);
        const excludeId = exclude ? exclude.id : null;
        
        for (const [id, client] of this.connections.entries()) {
            if (id !== excludeId && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    joinRoom(ws, room) {
        if (!this.rooms.has(room)) {
            this.rooms.set(room, new Set());
        }
        this.rooms.get(room).add(ws.id); // Store connection ID instead of object
        ws.rooms.add(room);
        LogManager.debug('Client joined room', { 
            connectionId: ws.id,
            room,
            clients: this.rooms.get(room).size,
            worker: this.workerId
        });
    }

    leaveRoom(ws, room) {
        if (this.rooms.has(room)) {
            this.rooms.get(room).delete(ws.id); // Delete by ID
            if (this.rooms.get(room).size === 0) {
                this.rooms.delete(room);
            }
        }
        ws.rooms.delete(room);
        LogManager.debug('Client left room', { 
            connectionId: ws.id,
            room,
            remainingClients: this.rooms.has(room) ? this.rooms.get(room).size : 0,
            worker: this.workerId
        });
    }

    broadcastToRoom(room, data, exclude = null) {
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
    localRoomBroadcast(room, data, exclude = null) {
        if (!this.rooms.has(room)) return;

        const message = JSON.stringify(data);
        const excludeId = exclude ? exclude.id : null;
        
        // Get connection IDs in this room
        const roomMembers = this.rooms.get(room);
        
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

    getConnections() {
        return this.connections.size;
    }

    getRooms() {
        const roomStats = {};
        this.rooms.forEach((clients, room) => {
            roomStats[room] = clients.size;
        });
        return roomStats;
    }

    startHeartbeat() {
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

        this.wss.on('close', () => {
            clearInterval(interval);
        });
        
        LogManager.info('WebSocket heartbeat started', { worker: this.workerId });
    }

    close() {
        this.wss.close(() => {
            LogManager.info('WebSocket server closed', {
                closedConnections: this.connections.size,
                worker: this.workerId
            });
        });
    }

    // Add method to broadcast system notifications
    broadcastSystemNotification(title, message, level = 'info') {
        const notification = {
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

module.exports = new WebsocketManager();