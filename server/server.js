const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'online', 
            clients: wss.clients.size,
            uptime: Math.floor(process.uptime()),
            timestamp: Date.now()
        }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('🌍 Global Chat WebSocket Server is Running!');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

let messageHistory = [];
const MAX_HISTORY = 100;
const clients = new Map(); // Track clients with their usernames

console.log('🚀 Starting WebSocket server...');

// Broadcast to all connected clients
function broadcast(data, excludeClient = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== excludeClient) {
            client.send(message);
        }
    });
}

// Send online count to all clients
function broadcastOnlineCount() {
    broadcast({
        type: 'online_count',
        count: wss.clients.size
    });
}

// Clean old messages (keep last 100)
function cleanMessageHistory() {
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory = messageHistory.slice(-MAX_HISTORY);
    }
}

wss.on('connection', (ws, req) => {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const clientId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`✅ New connection from ${clientIP} [ID: ${clientId}]`);
    console.log(`👥 Total clients: ${wss.clients.size}`);

    // Store client info
    clients.set(ws, {
        id: clientId,
        ip: clientIP,
        username: null,
        connectedAt: Date.now()
    });

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connected',
        clientId: clientId,
        serverTime: Date.now(),
        message: 'Connected to Global Chat Server'
    }));

    // Send message history
    ws.send(JSON.stringify({
        type: 'history',
        messages: messageHistory
    }));

    // Update online count for all
    broadcastOnlineCount();

    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const parsed = JSON.parse(data.toString());
            
            switch(parsed.type) {
                case 'message':
                    handleChatMessage(ws, parsed);
                    break;
                
                case 'set_username':
                    handleSetUsername(ws, parsed);
                    break;
                
                case 'ping':
                    ws.send(JSON.stringify({ 
                        type: 'pong', 
                        timestamp: Date.now() 
                    }));
                    break;
                
                default:
                    console.log(`⚠️ Unknown message type: ${parsed.type}`);
            }
        } catch (error) {
            console.error('❌ Error parsing message:', error.message);
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        const clientInfo = clients.get(ws);
        console.log(`👋 Client disconnected: ${clientInfo?.username || clientInfo?.id}`);
        console.log(`👥 Total clients: ${wss.clients.size}`);
        
        // Announce user left
        if (clientInfo?.username) {
            broadcast({
                type: 'system_message',
                message: `${clientInfo.username} left the chat`,
                timestamp: Date.now()
            });
        }
        
        clients.delete(ws);
        broadcastOnlineCount();
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });
});

// Handle chat messages
function handleChatMessage(ws, data) {
    const clientInfo = clients.get(ws);
    
    if (!data.message || typeof data.message !== 'string') {
        return;
    }

    const message = data.message.trim().substring(0, 500); // Limit message length
    
    if (!message) {
        return;
    }

    const username = data.username?.trim().substring(0, 20) || clientInfo?.username || 'Anonymous';
    
    const messageData = {
        type: 'message',
        username: username,
        message: message,
        timestamp: Date.now()
    };

    console.log(`💬 ${username}: ${message}`);

    // Add to history
    messageHistory.push(messageData);
    cleanMessageHistory();

    // Broadcast to all clients
    broadcast(messageData);
}

// Handle username setting
function handleSetUsername(ws, data) {
    const clientInfo = clients.get(ws);
    const newUsername = data.username?.trim().substring(0, 20);
    
    if (newUsername && clientInfo) {
        const oldUsername = clientInfo.username;
        clientInfo.username = newUsername;
        
        console.log(`👤 Username set: ${newUsername} [ID: ${clientInfo.id}]`);
        
        // Send confirmation
        ws.send(JSON.stringify({
            type: 'username_set',
            username: newUsername
        }));
        
        // Announce to others
        if (!oldUsername) {
            broadcast({
                type: 'system_message',
                message: `${newUsername} joined the chat`,
                timestamp: Date.now()
            }, ws);
        }
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`✨ Server running on port ${PORT}`);
    console.log(`🌐 WebSocket: ws://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`📡 Ready for connections!\n`);
});

// Heartbeat to keep connections alive
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// Log status every minute
setInterval(() => {
    console.log(`💓 Server alive | Clients: ${wss.clients.size} | Messages: ${messageHistory.length} | Uptime: ${Math.floor(process.uptime())}s`);
}, 60000);

// Graceful shutdown
function shutdown() {
    console.log('\n⚠️ Shutting down gracefully...');
    
    // Notify all clients
    broadcast({
        type: 'server_shutdown',
        message: 'Server is shutting down...'
    });
    
    // Close all connections
    wss.clients.forEach((client) => {
        client.close(1000, 'Server shutting down');
    });
    
    server.close(() => {
        console.log('👋 Server closed');
        process.exit(0);
    });
    
    // Force close after 5 seconds
    setTimeout(() => {
        console.error('⚠️ Forced shutdown');
        process.exit(1);
    }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
