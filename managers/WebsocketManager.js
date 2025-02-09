const WebSocket = require('ws');
const LogManager = require('./LogManager');

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

    handleConnection(ws, req) {
        // Run through middlewares
        if (!this.runMiddlewares(ws, req)) {
            ws.close();
            return;
        }

        this.connections.add(ws);
        LogManager.info(`New WebSocket connection from ${req.socket.remoteAddress}`);

        ws.isAlive = true;
        ws.rooms = new Set();

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);
                await this.handleMessage(ws, message);
            } catch (error) {
                LogManager.error('Error handling WebSocket message:', error);
                ws.send(JSON.stringify({ error: 'Invalid message format' }));
            }
        });

        ws.on('close', () => {
            this.handleDisconnection(ws);
        });

        ws.on('error', (error) => {
            LogManager.error('WebSocket error:', error);
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
        LogManager.info('Client disconnected from WebSocket');
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
        LogManager.info('Added new WebSocket middleware');
    }

    runMiddlewares(ws, req) {
        return this.middlewares.every(middleware => middleware(ws, req));
    }

    registerEvent(event, callback) {
        this.events.set(event, callback);
        LogManager.info(`Registered WebSocket event: ${event}`);
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
        LogManager.debug(`Client joined room: ${room}`);
    }

    leaveRoom(ws, room) {
        if (this.rooms.has(room)) {
            this.rooms.get(room).delete(ws);
            if (this.rooms.get(room).size === 0) {
                this.rooms.delete(room);
            }
        }
        ws.rooms.delete(room);
        LogManager.debug(`Client left room: ${room}`);
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
            LogManager.info('WebSocket server closed');
        });
    }
}

module.exports = new WebsocketManager();