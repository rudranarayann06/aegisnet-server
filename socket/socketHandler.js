const { Server } = require('socket.io');
const { getAdmin } = require('../config/firebase');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      if (process.env.NODE_ENV === 'development') return next();
      return next(new Error('Authentication required'));
    }

    try {
      const admin = getAdmin();
      if (admin) {
        const decoded = await admin.auth().verifyIdToken(token);
        socket.user = { uid: decoded.uid, role: decoded.role || 'citizen' };
      } else {
        socket.user = { uid: 'dev-user', role: 'admin' };
      }
      next();
    } catch {
      if (process.env.NODE_ENV === 'development') {
        socket.user = { uid: 'dev-user', role: 'admin' };
        return next();
      }
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.user?.uid || 'anonymous';

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Socket] Client connected: ${uid} (${socket.id})`);
    }

    // Update user online status
    updateUserOnlineStatus(uid, true);

    // Handle zone join (for zone-specific alerts)
    socket.on('join_zone', (zoneId) => {
      if (typeof zoneId === 'string' && zoneId.match(/^zone-\w+$/)) {
        socket.join(`zone-${zoneId}`);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Socket] ${uid} joined zone: ${zoneId}`);
        }
      }
    });

    // Handle responder location updates
    socket.on('responder_location', (payload) => {
      if (!payload?.lat || !payload?.lng) return;
      // Broadcast to all admins/commanders in the same zone
      io.emit('responder_update', {
        responderId: uid,
        location: { lat: payload.lat, lng: payload.lng },
        timestamp: new Date().toISOString(),
      });

      // Update Firestore location
      updateResponderLocation(uid, payload);
    });

    // Handle mark safe
    socket.on('mark_safe', (userId) => {
      io.emit('user_safe', { userId: userId || uid, timestamp: new Date().toISOString() });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      updateUserOnlineStatus(uid, false);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Socket] Client disconnected: ${uid} (${reason})`);
      }
    });

    // Send initial connection ack
    socket.emit('connected', {
      message: 'Connected to AegisNet AI real-time network',
      serverId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  return io;
}

async function updateUserOnlineStatus(uid, isOnline) {
  const admin = getAdmin();
  if (!admin) return;
  try {
    await admin.firestore().collection('users').doc(uid).update({
      isOnline,
      lastSeen: new Date().toISOString(),
    });
  } catch {}
}

async function updateResponderLocation(uid, location) {
  const admin = getAdmin();
  if (!admin) return;
  try {
    await admin.firestore().collection('responders').doc(uid).update({
      currentLocation: { lat: location.lat, lng: location.lng },
      updatedAt: new Date().toISOString(),
    });
  } catch {}
}

function getSocket() {
  return io;
}

module.exports = { initSocket, getSocket };
