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
    const role = socket.user?.role || 'citizen';

    // Auto-join role room
    socket.join(`role-${role}`);

    // Responders join their personal room for targeted dispatch
    if (role === 'responder') {
      socket.join(`responder-${uid}`);
    }

    // Join zone room
    socket.on('join_zone', (zoneId) => {
      if (typeof zoneId === 'string' && /^zone-[\w-]+$/.test(zoneId)) {
        socket.join(`zone-${zoneId}`);
      }
    });

    // Responder location broadcast
    socket.on('responder_location', async (payload) => {
      if (!payload?.lat || !payload?.lng) return;
      io.to('role-admin').emit('responder_update', {
        responderId: uid,
        location: { lat: payload.lat, lng: payload.lng },
        timestamp: new Date().toISOString(),
      });
      updateResponderLocation(uid, payload);
    });

    // Responder accepts/declines dispatch (real-time via socket)
    socket.on('dispatch_response', async (payload) => {
      const { incidentId, action, reason } = payload;
      if (!incidentId || !['accept', 'decline'].includes(action)) return;

      // Forward to all admin/commander connections immediately
      io.to('role-admin').emit('dispatch_response_received', {
        incidentId,
        responderId: uid,
        action,
        reason: reason || '',
        timestamp: new Date().toISOString(),
      });

      // If declined, notify next standby
      if (action === 'decline') {
        io.emit('dispatch_escalated', {
          incidentId,
          declinedBy: uid,
          message: `${uid} declined — escalating to next responder`,
          timestamp: new Date().toISOString(),
        });
      }

      // Persist to DB via HTTP PATCH (client should also call /api/emergency/:id/dispatch)
    });

    // Mark safe
    socket.on('mark_safe', (userId) => {
      io.emit('user_safe', { userId: userId || uid, timestamp: new Date().toISOString() });
    });

    // Disconnect
    socket.on('disconnect', () => {
      updateUserOnlineStatus(uid, false);
    });

    // ACK
    socket.emit('connected', {
      message: 'AegisNet AI — Real-time network active',
      uid,
      role,
      timestamp: new Date().toISOString(),
    });

    updateUserOnlineStatus(uid, true);
  });

  return io;
}

async function updateUserOnlineStatus(uid, isOnline) {
  const admin = getAdmin();
  if (!admin) return;
  try {
    await admin.firestore().collection('users').doc(uid).update({ isOnline, lastSeen: new Date().toISOString() });
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

function getSocket() { return io; }

module.exports = { initSocket, getSocket };
