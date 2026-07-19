const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');
const socketService = require('./services/socketService');

const startServer = async () => {
  await connectDB();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000"
    }
  });

  socketService.init(io);

  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-cafe', (cafeId) => {
      socket.join(`cafe-${cafeId}`);
      console.log(`Socket ${socket.id} joined cafe room: cafe-${cafeId}`);
    });

    socket.on('join-order', (orderId) => {
      socket.join(`order-${orderId}`);
      console.log(`Socket ${socket.id} joined order room: order-${orderId}`);
    });

    socket.on('join-session', (sessionId) => {
      socket.join(`session-${sessionId}`);
      console.log(`Socket ${socket.id} joined session room: session-${sessionId}`);
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected:', socket.id);
    });
  });

  server.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});


