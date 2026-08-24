process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6,
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const ROOM_PASSWORD = 'ovo';

app.use(express.static(path.join(__dirname, 'public')));

// Connected users: socketId -> { nickname, avatar, sharing }
const users = new Map();

io.on('connection', (socket) => {
  console.log(`[+] Conectou: ${socket.id}`);

  // Authentication
  socket.on('auth', ({ password, nickname, avatar }, callback) => {
    if (password !== ROOM_PASSWORD) {
      return callback({ success: false, message: 'Senha incorreta!' });
    }
    if (!nickname || !nickname.trim()) {
      return callback({ success: false, message: 'Nickname é obrigatório!' });
    }

    const user = { nickname: nickname.trim(), avatar: avatar || null, sharing: false };
    users.set(socket.id, user);
    socket.join('room');

    // Build participants list with sharing state
    const participants = [];
    for (const [id, u] of users.entries()) {
      participants.push({
        id,
        nickname: u.nickname,
        avatar: u.avatar,
        sharing: u.sharing
      });
    }

    callback({ success: true, userId: socket.id, participants });

    // Notify everyone else
    socket.to('room').emit('user-joined', {
      id: socket.id,
      nickname: user.nickname,
      avatar: user.avatar,
      sharing: user.sharing
    });

    console.log(`[AUTH] ${user.nickname} entrou. Total: ${users.size}`);
  });

  // ─── WebRTC Signaling (relay everything transparently) ───

  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', { ...data, from: socket.id });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', { ...data, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', { ...data, from: socket.id });
  });

  socket.on('request-stream', (data) => {
    socket.to(data.to).emit('request-stream', { from: socket.id });
  });

  socket.on('stop-watching', (data) => {
    socket.to(data.to).emit('stop-watching', { from: socket.id });
  });

  // ─── Sharing state ──────────────────────────────────────

  socket.on('start-sharing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.sharing = true;
      socket.to('room').emit('user-start-sharing', { id: socket.id });
      console.log(`[SHARE] ${user.nickname} começou a compartilhar`);
    }
  });

  socket.on('stop-sharing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.sharing = false;
      io.to('room').emit('user-stop-sharing', { id: socket.id });
      console.log(`[SHARE] ${user.nickname} parou de compartilhar`);
    }
  });

  // ─── Disconnect ──────────────────────────────────────────

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    if (user) {
      io.to('room').emit('user-left', { id: socket.id });
      console.log(`[-] ${user.nickname} saiu. Total: ${users.size}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`   Senha da sala: ${ROOM_PASSWORD}\n`);
}).on('error', (err) => {
  console.error('Server listen error:', err);
});

// Keep process alive
setInterval(() => {}, 1000);
