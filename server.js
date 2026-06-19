const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB for file transfers
});

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || 'letmein';
const MAX_USERS = 2;

app.use(express.static(path.join(__dirname, 'public')));

// Track connected users: socket.id -> username
const users = new Map();

// Track message ownership: messageId -> socket.id (for delete validation)
const messageOwners = new Map();

io.on('connection', (socket) => {
  const { username, accessCode } = socket.handshake.auth || {};

  if (accessCode !== ACCESS_CODE) {
    socket.emit('join_error', 'Wrong access code.');
    socket.disconnect(true);
    return;
  }

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    socket.emit('join_error', 'Username is required.');
    socket.disconnect(true);
    return;
  }

  if (users.size >= MAX_USERS) {
    socket.emit('join_error', 'Chat is full (2/2). Try again later.');
    socket.disconnect(true);
    return;
  }

  const trimmedUsername = username.trim().slice(0, 20);

  users.set(socket.id, trimmedUsername);
  socket.broadcast.emit('user_joined', { username: trimmedUsername });

  // Emit join_success and then presence atomically
  socket.emit('join_success', { username: trimmedUsername });
  socket.emit('presence', { online: users.size, users: Array.from(users.values()) });
  socket.broadcast.emit('presence', { online: users.size, users: Array.from(users.values()) });

  // ─── Enhanced Chat Message ───
  socket.on('chat_message', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    const validTypes = ['text', 'image', 'file', 'gif', 'sticker', 'voice'];
    const type = validTypes.includes(msg.type) ? msg.type : 'text';

    // For text messages, validate text content
    if (type === 'text') {
      if (typeof msg.text !== 'string') return;
      const trimmed = msg.text.trim().slice(0, 5000);
      if (trimmed.length === 0) return;
      msg.text = trimmed;
    }

    // Build the broadcast payload
    const payload = {
      messageId: msg.messageId || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
      id: socket.id,
      username: users.get(socket.id),
      type: type,
      text: msg.text || '',
      timestamp: Date.now(),
    };

    // Attach file data if present
    if (msg.fileData) {
      payload.fileData = msg.fileData;
      payload.fileName = (msg.fileName || 'file').slice(0, 255);
      payload.fileType = (msg.fileType || 'application/octet-stream').slice(0, 100);
      payload.fileSize = msg.fileSize || 0;
    }

    // Attach GIF/sticker URL
    if (msg.gifUrl) {
      payload.gifUrl = msg.gifUrl;
    }

    // Attach reply context
    if (msg.replyTo && typeof msg.replyTo === 'object') {
      payload.replyTo = {
        messageId: msg.replyTo.messageId,
        username: msg.replyTo.username,
        preview: (msg.replyTo.preview || '').slice(0, 100),
        type: msg.replyTo.type || 'text'
      };
    }

    // Track ownership for deletion
    messageOwners.set(payload.messageId, socket.id);

    // Send to all clients
    io.emit('chat_message', payload);

    // Confirm delivery to the other user
    socket.broadcast.emit('message_delivered', { messageId: payload.messageId });
  });

  // ─── Delete Message ───
  socket.on('delete_message', (data) => {
    if (!data || !data.messageId) return;

    // Only allow the sender to delete their own messages
    if (messageOwners.get(data.messageId) !== socket.id) return;

    io.emit('message_deleted', {
      messageId: data.messageId,
      deletedBy: users.get(socket.id)
    });
  });

  // ─── Read Receipts ───
  socket.on('read_receipt', (data) => {
    if (!data || !data.messageIds || !Array.isArray(data.messageIds)) return;

    // Notify the sender(s) that their messages were read
    socket.broadcast.emit('messages_read', {
      messageIds: data.messageIds,
      readBy: users.get(socket.id)
    });
  });

  // ─── Emoji Reactions ───
  socket.on('reaction', (data) => {
    if (!data || !data.messageId || !data.emoji) return;

    const allowedEmojis = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
    if (!allowedEmojis.includes(data.emoji)) return;

    io.emit('reaction', {
      messageId: data.messageId,
      emoji: data.emoji,
      username: users.get(socket.id)
    });
  });

  // ─── Typing ───
  socket.on('typing', () => {
    socket.broadcast.emit('typing', { username: users.get(socket.id) });
  });

  socket.on('stop_typing', () => {
    socket.broadcast.emit('stop_typing', { username: users.get(socket.id) });
  });

  // ─── Disconnect ───
  socket.on('disconnect', () => {
    const name = users.get(socket.id);
    users.delete(socket.id);
    if (name) {
      socket.broadcast.emit('user_left', { username: name });
      socket.broadcast.emit('stop_typing', { username: name });
      io.emit('presence', { online: users.size, users: Array.from(users.values()) });
    }
  });
});

let runningServer = null;

// Start Server Wrapper
function startServer(port) {
  return new Promise((resolve) => {
    runningServer = server.listen(port, () => {
      resolve(runningServer);
    });
  });
}

// Stop Server Wrapper
function stopServer() {
  return new Promise((resolve) => {
    // Disconnect all clients at transport level to trigger auto-reconnect on client
    io.sockets.sockets.forEach((socket) => {
      if (socket.conn) {
        socket.conn.close();
      }
    });
    users.clear();
    messageOwners.clear();
    if (runningServer) {
      runningServer.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Check if running directly or required
if (require.main === module) {
  startServer(PORT).then(() => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, server, io, startServer, stopServer };
