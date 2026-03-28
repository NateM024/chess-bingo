const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// roomId -> { players: [socketId, socketId], state: {...} }
const rooms = new Map();

function makeRoomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function createRoomState() {
  return {
    players: [],        // [{ id, name, color }]
    chess: {
      fen: 'start',
      history: []
    },
    bingo: {
      // per player: { board: [...events], marked: [indices] }
    },
    gameOver: null      // { reason, winner }
  };
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // ── Create a new room ──
  socket.on('create_room', ({ name }, cb) => {
    const roomId = makeRoomId();
    const state = createRoomState();
    state.players.push({ id: socket.id, name, color: 'white' });
    rooms.set(roomId, state);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = 'white';
    console.log(`Room ${roomId} created by ${name}`);
    cb({ roomId, color: 'white' });
  });

  // ── Join an existing room ──
  socket.on('join_room', ({ roomId, name }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ error: 'Room not found' });
    if (room.players.length >= 2) return cb({ error: 'Room is full' });
    if (room.gameOver) return cb({ error: 'Game already finished' });

    room.players.push({ id: socket.id, name, color: 'black' });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = 'black';

    cb({ color: 'black', opponentName: room.players[0].name });

    // Tell white that black joined
    io.to(room.players[0].id).emit('opponent_joined', { name });

    console.log(`${name} joined room ${roomId}`);
  });

  // ── Player sends their bingo board (generated client-side) ──
  socket.on('register_board', ({ board }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    if (!room.bingo) room.bingo = {};
    room.bingo[socket.id] = { board, marked: new Set([12]) };
  });

  // ── Chess move ──
  socket.on('chess_move', ({ move, fen, pgn }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;

    room.chess.fen = fen;
    room.chess.history = pgn;

    // Broadcast to the OTHER player
    socket.to(roomId).emit('chess_move', { move, fen, pgn });
  });

  // ── Bingo square marked ──
  socket.on('mark_square', ({ index }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;

    if (room.bingo && room.bingo[socket.id]) {
      const p = room.bingo[socket.id];
      if (p.marked.has(index)) p.marked.delete(index);
      else p.marked.add(index);
    }

    // Let the other player see what you marked (for spectating)
    socket.to(roomId).emit('opponent_marked', { index });
  });

  // ── Bingo win declared ──
  socket.on('claim_bingo', ({ lines }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;

    const winner = room.players.find(p => p.id === socket.id);
    room.gameOver = { reason: 'bingo', winner: winner?.name };

    io.to(roomId).emit('game_over', {
      reason: 'bingo',
      winner: winner?.name,
      winnerId: socket.id,
      lines
    });
    console.log(`Bingo win in room ${roomId} by ${winner?.name}`);
  });

  // ── Checkmate declared (client detects via chess.js) ──
  socket.on('claim_checkmate', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;

    const winner = room.players.find(p => p.id === socket.id);
    room.gameOver = { reason: 'checkmate', winner: winner?.name };

    io.to(roomId).emit('game_over', {
      reason: 'checkmate',
      winner: winner?.name,
      winnerId: socket.id
    });
    console.log(`Checkmate in room ${roomId} by ${winner?.name}`);
  });

  // ── Resign ──
  socket.on('resign', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;

    const loser = room.players.find(p => p.id === socket.id);
    const winner = room.players.find(p => p.id !== socket.id);
    room.gameOver = { reason: 'resign', winner: winner?.name };

    io.to(roomId).emit('game_over', {
      reason: 'resign',
      winner: winner?.name,
      winnerId: winner?.id,
      loserName: loser?.name
    });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    socket.to(roomId).emit('opponent_disconnected');

    // Clean up room after 10 minutes
    setTimeout(() => {
      if (rooms.has(roomId)) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up`);
      }
    }, 10 * 60 * 1000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess Bingo server running on http://localhost:${PORT}`);
});
