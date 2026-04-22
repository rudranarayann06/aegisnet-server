const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { validateAssignment } = require('../models/responder');
const { notifyResponder, broadcastIncidentUpdate } = require('../services/notificationService');
const { getAdmin } = require('../config/firebase');

const memResponders = new Map([
  ['resp-001', { id: 'resp-001', name: 'Arjun Sharma', zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2965, lng: 85.8250 }, skills: ['Fire', 'Rescue'], isOnline: true }],
  ['resp-002', { id: 'resp-002', name: 'Priya Patel', zone: 'zone-1', status: 'en-route', currentLocation: { lat: 20.2900, lng: 85.8180 }, skills: ['Medical', 'First Aid'], isOnline: true }],
  ['resp-003', { id: 'resp-003', name: 'Ravi Kumar', zone: 'zone-2', status: 'available', currentLocation: { lat: 20.2800, lng: 85.8300 }, skills: ['Evacuation', 'Comms'], isOnline: true }],
]);

function getDb() {
  return getAdmin()?.firestore() || null;
}

// GET /api/responder/available
router.get('/available', auth, async (req, res, next) => {
  try {
    const { zone } = req.query;
    const db = getDb();

    let responders = [];
    if (db) {
      let query = db.collection('responders').where('isOnline', '==', true);
      if (zone) query = query.where('zone', '==', zone);
      const snap = await query.get();
      responders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      responders = Array.from(memResponders.values())
        .filter((r) => r.isOnline)
        .filter((r) => !zone || r.zone === zone);
    }

    res.json({ success: true, count: responders.length, responders });
  } catch (err) {
    next(err);
  }
});

// POST /api/responder/assign
router.post('/assign', auth, async (req, res, next) => {
  try {
    const { incidentId, responderId } = req.body;

    const validationErrors = validateAssignment({ incidentId, responderId });
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const db = getDb();
    const now = new Date().toISOString();

    if (db) {
      const responderRef = db.collection('responders').doc(responderId);
      const incidentRef = db.collection('incidents').doc(incidentId);

      const [rSnap, iSnap] = await Promise.all([responderRef.get(), incidentRef.get()]);
      if (!rSnap.exists) return res.status(404).json({ error: 'Responder not found' });
      if (!iSnap.exists) return res.status(404).json({ error: 'Incident not found' });

      await Promise.all([
        responderRef.update({ status: 'en-route', activeIncident: incidentId, updatedAt: now }),
        incidentRef.update({ assignedTo: responderId, status: 'active', updatedAt: now }),
      ]);

      const incidentData = { id: incidentId, ...iSnap.data() };
      await notifyResponder(responderId, incidentData);
    } else {
      const responder = memResponders.get(responderId);
      if (!responder) return res.status(404).json({ error: 'Responder not found' });
      memResponders.set(responderId, { ...responder, status: 'en-route', activeIncident: incidentId });
    }

    await broadcastIncidentUpdate(incidentId, { assignedTo: responderId, status: 'active' });

    res.json({ success: true, incidentId, responderId, message: 'Responder assigned successfully' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/responder/:id/location
router.patch('/:id/location', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lat, lng } = req.body;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    const db = getDb();
    const location = { lat, lng, updatedAt: new Date().toISOString() };

    if (db) {
      await db.collection('responders').doc(id).update({ currentLocation: location });
    } else {
      const r = memResponders.get(id);
      if (r) memResponders.set(id, { ...r, currentLocation: location });
    }

    // Broadcast to incident commanders
    const { getSocket } = require('../socket/socketHandler');
    const io = getSocket();
    if (io) io.emit('responder_update', { responderId: id, location });

    res.json({ success: true, responderId: id, location });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/responder/:id/status
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const VALID = ['available', 'en-route', 'on-scene', 'off-duty'];
    if (!status || !VALID.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
    }

    const db = getDb();
    const updates = { status, updatedAt: new Date().toISOString() };

    if (db) {
      await db.collection('responders').doc(id).update(updates);
    } else {
      const r = memResponders.get(id);
      if (r) memResponders.set(id, { ...r, ...updates });
    }

    res.json({ success: true, responderId: id, status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
