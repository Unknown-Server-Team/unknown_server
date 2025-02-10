const WebSocket = require('ws');
const LogManager = require('./LogManager');
const PermissionManager = require('./PermissionManager');
const AuthMonitor = require('./AuthMonitor');
const SessionMonitor = require('./SessionMonitor');

class WebsocketManager {
    constructor() {
        this.connections = new Set();
        this.events = new Map();
        this.rooms = new Map();
        this.middlewares = [];
    }

    initialize(server) {
        this.wss = new WebSocket.Server({ server });
        
        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        LogManager.success('WebSocket server initialized');
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

        this.connections.add(ws);
        LogManager.info('New WebSocket connection', { 
            ip: req.socket.remoteAddress,
            totalConnections: this.connections.size
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
                userAgent: req.headers['user-agent']
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
        ws.send(JSON.stringify({ type: 'connection', message: 'Connected to WebSocket server' }));
    }

    handleDisconnection(ws) {
        // Remove from all rooms
        ws.rooms.forEach(room => {
            this.leaveRoom(ws, room);
        });

        this.connections.delete(ws);
        LogManager.info('Client disconnected', {
            remainingConnections: this.connections.size
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

    broadcast(data, exclude = null) {
        const message = JSON.stringify(data);
        this.connections.forEach(client => {
            if (client !== exclude && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    joinRoom(ws, room) {
        if (!this.rooms.has(room)) {
            this.rooms.set(room, new Set());
        }
        this.rooms.get(room).add(ws);
        ws.rooms.add(room);
        LogManager.debug('Client joined room', { 
            room,
            clients: this.rooms.get(room).size 
        });
    }

    leaveRoom(ws, room) {
        if (this.rooms.has(room)) {
            this.rooms.get(room).delete(ws);
            if (this.rooms.get(room).size === 0) {
                this.rooms.delete(room);
            }
        }
        ws.rooms.delete(room);
        LogManager.debug('Client left room', { 
            room,
            remainingClients: this.rooms.has(room) ? this.rooms.get(room).size : 0
        });
    }

    broadcastToRoom(room, data, exclude = null) {
        if (!this.rooms.has(room)) return;

        const message = JSON.stringify(data);
        this.rooms.get(room).forEach(client => {
            if (client !== exclude && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
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
            this.connections.forEach(ws => {
                if (ws.isAlive === false) {
                    LogManager.debug('Terminating inactive WebSocket connection');
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);

        this.wss.on('close', () => {
            clearInterval(interval);
        });
    }

    close() {
        this.wss.close(() => {
            LogManager.info('WebSocket server closed', {
                closedConnections: this.connections.size
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