const { getSocket } = require('../socket/socketHandler');
const { getAdmin } = require('../config/firebase');

async function broadcastNewIncident(incident) {
  const io = getSocket();
  if (io) {
    io.emit('new_incident', incident);
    io.to(`zone-${incident.zone || 'zone-1'}`).emit('new_incident', incident);

    // Notify each dispatched responder individually
    if (incident.dispatchChain?.length) {
      incident.dispatchChain.forEach((d, idx) => {
        io.to(`responder-${d.responderId}`).emit('dispatch_notification', {
          incident,
          role: idx === 0 ? 'PRIMARY' : 'STANDBY',
          dispatchStatus: d.status,
          message: idx === 0
            ? `🚨 MISSION ASSIGNED — You are PRIMARY responder. Accept within 30s.`
            : `⏳ STANDBY ALERT — You are backup. Accept ONLY if primary declines.`,
        });
      });
    }
  }
}

async function broadcastIncidentUpdate(incidentId, changes) {
  const io = getSocket();
  if (io) {
    io.emit('incident_updated', { id: incidentId, changes, timestamp: new Date().toISOString() });
  }
}

async function broadcastDispatchUpdate(incidentId, chain) {
  const io = getSocket();
  if (io) {
    io.emit('dispatch_updated', { incidentId, chain, timestamp: new Date().toISOString() });
    // Notify standby who just got promoted
    const newPrimary = chain.find((d) => d.status === 'notified');
    if (newPrimary) {
      io.to(`responder-${newPrimary.responderId}`).emit('dispatch_promoted', {
        incidentId,
        message: '🔔 PRIMARY ACTIVATED — Previous responder declined. You are now the primary. Accept within 30s.',
      });
    }
  }
}

async function broadcastSystemAlert(zoneId, alert) {
  const io = getSocket();
  if (io) {
    io.to(`zone-${zoneId}`).emit('system_alert', { ...alert, timestamp: new Date().toISOString() });
  }
}

async function sendPushNotification(fcmToken, payload) {
  const admin = getAdmin();
  if (!admin || !fcmToken) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: payload.title || 'AegisNet Alert', body: payload.body },
      data: { incidentId: payload.incidentId || '', type: payload.type || 'alert', role: payload.role || '' },
      android: { priority: 'high', notification: { channelId: 'aegisnet-dispatch' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FCM]', err.message);
    }
  }
}

async function notifyResponder(responderId, incidentData, role = 'PRIMARY') {
  const admin = getAdmin();
  if (!admin) return;
  try {
    const db = admin.firestore();
    const snap = await db.collection('responders').doc(responderId).get();
    if (!snap.exists) return;
    const { fcmToken } = snap.data();
    if (fcmToken) {
      await sendPushNotification(fcmToken, {
        title: role === 'PRIMARY' ? '🚨 Mission Assigned — Action Required' : '⏳ Standby Alert',
        body: `${incidentData.subcategory || incidentData.type} at ${incidentData.location?.address}`,
        incidentId: incidentData.id,
        role,
      });
    }
  } catch {}
}

module.exports = {
  broadcastNewIncident,
  broadcastIncidentUpdate,
  broadcastDispatchUpdate,
  broadcastSystemAlert,
  sendPushNotification,
  notifyResponder,
};
