const { getSocket } = require('../socket/socketHandler');
const { getAdmin } = require('../config/firebase');

async function broadcastNewIncident(incident) {
  const io = getSocket();
  if (io) {
    io.emit('new_incident', incident);
    io.to(`zone-${incident.zone || 'zone-1'}`).emit('new_incident', incident);
  }
}

async function broadcastIncidentUpdate(incidentId, changes) {
  const io = getSocket();
  if (io) {
    io.emit('incident_updated', { id: incidentId, changes, timestamp: new Date().toISOString() });
  }
}

async function broadcastSystemAlert(zoneId, alert) {
  const io = getSocket();
  if (io) {
    io.to(`zone-${zoneId}`).emit('system_alert', {
      ...alert,
      timestamp: new Date().toISOString(),
    });
  }
}

async function sendPushNotification(fcmToken, payload) {
  const admin = getAdmin();
  if (!admin || !fcmToken) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: payload.title || 'AegisNet Alert',
        body: payload.body,
      },
      data: {
        incidentId: payload.incidentId || '',
        type: payload.type || 'alert',
        url: payload.url || '/',
      },
      android: { priority: 'high', notification: { channelId: 'aegisnet-alerts' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FCM] Push notification failed:', err.message);
    }
  }
}

async function notifyResponder(responderId, incidentData) {
  const admin = getAdmin();
  if (!admin) return;

  try {
    const db = admin.firestore();
    const responderDoc = await db.collection('responders').doc(responderId).get();
    if (!responderDoc.exists) return;

    const { fcmToken } = responderDoc.data();
    if (fcmToken) {
      await sendPushNotification(fcmToken, {
        title: '🚨 New Mission Assigned',
        body: `${incidentData.type?.toUpperCase()} at ${incidentData.location?.address}`,
        incidentId: incidentData.id,
        type: 'mission',
      });
    }
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Notification] Responder notify failed:', err.message);
    }
  }
}

module.exports = {
  broadcastNewIncident,
  broadcastIncidentUpdate,
  broadcastSystemAlert,
  sendPushNotification,
  notifyResponder,
};
