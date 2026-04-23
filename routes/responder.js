const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAdmin } = require('../config/firebase');
const { broadcastIncidentUpdate } = require('../services/notificationService');

const RESPONDER_POOL = [
  { id: 'resp-f1', name: 'Arjun Sharma',        type: 'firefighter', role: 'Lead Firefighter', badge: 'FF-201', zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2965, lng: 85.8250 }, skills: ['Fire', 'Rescue', 'HAZMAT'], isOnline: true },
  { id: 'resp-f2', name: 'Deepak Rao',           type: 'firefighter', role: 'Firefighter',      badge: 'FF-202', zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2910, lng: 85.8220 }, skills: ['Fire', 'First Aid'],          isOnline: true },
  { id: 'resp-f3', name: 'Sujit Nayak',          type: 'firefighter', role: 'Firefighter',      badge: 'FF-203', zone: 'zone-2', status: 'on-scene',  currentLocation: { lat: 20.2850, lng: 85.8300 }, skills: ['Aerial Rescue'],              isOnline: true },
  { id: 'resp-m1', name: 'Priya Patel',           type: 'paramedic',   role: 'Senior Paramedic', badge: 'PM-301', zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2900, lng: 85.8180 }, skills: ['ALS', 'Trauma', 'Cardiac'],   isOnline: true },
  { id: 'resp-m2', name: 'Rohit Mishra',          type: 'paramedic',   role: 'Paramedic',        badge: 'PM-302', zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2950, lng: 85.8100 }, skills: ['BLS', 'First Aid'],           isOnline: true },
  { id: 'resp-m3', name: 'Anita Das',             type: 'paramedic',   role: 'Paramedic',        badge: 'PM-303', zone: 'zone-2', status: 'en-route',  currentLocation: { lat: 20.3020, lng: 85.8150 }, skills: ['Obstetrics', 'Pediatrics'],   isOnline: true },
  { id: 'resp-p1', name: 'Insp. Ravi Kumar',      type: 'police',      role: 'Inspector',        badge: 'OD-1142',zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2980, lng: 85.8260 }, skills: ['Investigation', 'Negotiation'],isOnline: true },
  { id: 'resp-p2', name: 'SI Sneha Das',           type: 'police',      role: 'Sub Inspector',    badge: 'OD-1143',zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2940, lng: 85.8200 }, skills: ['Patrol', 'Crowd Control'],    isOnline: true },
  { id: 'resp-p3', name: 'Const. Mohan Behera',   type: 'police',      role: 'Constable',        badge: 'OD-1144',zone: 'zone-1', status: 'on-scene',  currentLocation: { lat: 20.2870, lng: 85.8290 }, skills: ['Patrol', 'Traffic'],          isOnline: true },
  { id: 'resp-r1', name: 'Kiran Swain',            type: 'rescue',      role: 'Rescue Specialist',badge: 'RS-401', zone: 'zone-1', status: 'available', currentLocation: { lat: 20.2920, lng: 85.8240 }, skills: ['Water Rescue', 'Rope'],       isOnline: true },
  { id: 'resp-r2', name: 'Tapan Sahoo',            type: 'rescue',      role: 'Rescue Diver',     badge: 'RS-402', zone: 'zone-2', status: 'available', currentLocation: { lat: 20.2800, lng: 85.8320 }, skills: ['Scuba', 'Underwater'],        isOnline: true },
];

const memResponders = new Map(RESPONDER_POOL.map((r) => [r.id, { ...r }]));

function getDb() { return getAdmin()?.firestore() || null; }

// GET /api/responder/available
router.get('/available', auth, async (req, res, next) => {
  try {
    const { type, zone, limit = 20 } = req.query;
    const db = getDb();
    let responders = [];

    if (db) {
      let q = db.collection('responders').where('isOnline', '==', true);
      if (type) q = q.where('type', '==', type);
      if (zone) q = q.where('zone', '==', zone);
      q = q.limit(parseInt(limit));
      const snap = await q.get();
      responders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      responders = Array.from(memResponders.values())
        .filter((r) => r.isOnline)
        .filter((r) => !type || r.type === type)
        .filter((r) => !zone || r.zone === zone)
        .slice(0, parseInt(limit));
    }

    res.json({ success: true, count: responders.length, responders });
  } catch (err) { next(err); }
});

// GET /api/responder/all
router.get('/all', auth, async (req, res, next) => {
  try {
    const db = getDb();
    let responders = [];

    if (db) {
      const snap = await db.collection('responders').get();
      responders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      responders = Array.from(memResponders.values());
    }

    // Group by type
    const grouped = responders.reduce((acc, r) => {
      if (!acc[r.type]) acc[r.type] = [];
      acc[r.type].push(r);
      return acc;
    }, {});

    res.json({ success: true, total: responders.length, grouped, responders });
  } catch (err) { next(err); }
});

// POST /api/responder/assign
router.post('/assign', auth, async (req, res, next) => {
  try {
    const { incidentId, responderId } = req.body;
    if (!incidentId || !responderId) {
      return res.status(400).json({ error: 'incidentId and responderId required' });
    }

    const db = getDb();
    const now = new Date().toISOString();

    if (db) {
      await Promise.all([
        db.collection('responders').doc(responderId).update({ status: 'en-route', activeIncident: incidentId, updatedAt: now }),
        db.collection('incidents').doc(incidentId).update({ assignedTo: responderId, status: 'active', updatedAt: now }),
      ]);
    } else {
      const r = memResponders.get(responderId);
      if (r) memResponders.set(responderId, { ...r, status: 'en-route', activeIncident: incidentId });
    }

    await broadcastIncidentUpdate(incidentId, { assignedTo: responderId, status: 'active' });
    res.json({ success: true, incidentId, responderId, message: 'Responder assigned' });
  } catch (err) { next(err); }
});

// PATCH /api/responder/:id/location
router.patch('/:id/location', auth, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    const location = { lat, lng, updatedAt: new Date().toISOString() };
    const db = getDb();

    if (db) {
      await db.collection('responders').doc(req.params.id).update({ currentLocation: location });
    } else {
      const r = memResponders.get(req.params.id);
      if (r) memResponders.set(req.params.id, { ...r, currentLocation: location });
    }

    const { getSocket } = require('../socket/socketHandler');
    getSocket()?.emit('responder_update', { responderId: req.params.id, location });

    res.json({ success: true, responderId: req.params.id, location });
  } catch (err) { next(err); }
});

// PATCH /api/responder/:id/status
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const { status } = req.body;
    const VALID = ['available', 'en-route', 'on-scene', 'off-duty'];
    if (!status || !VALID.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
    }

    const db = getDb();
    const updates = { status, updatedAt: new Date().toISOString() };

    if (db) {
      await db.collection('responders').doc(req.params.id).update(updates);
    } else {
      const r = memResponders.get(req.params.id);
      if (r) memResponders.set(req.params.id, { ...r, ...updates });
    }

    res.json({ success: true, responderId: req.params.id, status });
  } catch (err) { next(err); }
});

module.exports = router;
