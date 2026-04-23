const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { emergencyLimiter } = require('../middleware/rateLimiter');
const { getAdmin } = require('../config/firebase');
const { broadcastNewIncident, broadcastIncidentUpdate } = require('../services/notificationService');
const { v4: uuidv4 } = require('uuid');

const VALID_TYPES = ['fire', 'medical', 'flood', 'police', 'other'];
const VALID_STATUSES = ['pending', 'active', 'resolved', 'false_alarm'];
const DISPATCH_TIMEOUT_MS = 30000; // 30s to accept before auto-escalate

// Type → priority base score
const TYPE_PRIORITY = { fire: 8, medical: 7.5, flood: 7, police: 8, other: 4 };

// Subcategory → severity override
const SUBCATEGORY_SEVERITY = {
  'Kidnapping':      'critical',
  'Cardiac Arrest':  'critical',
  'Explosion':       'critical',
  'Riot / Hangama':  'high',
  'Road Accident':   'high',
  'Building Fire':   'critical',
  'Flash Flood':     'high',
  'Domestic Violence': 'high',
  'Missing Person':  'high',
};

// Responder type per incident type
const RESPONDER_TYPE = { fire: 'firefighter', medical: 'paramedic', flood: 'rescue', police: 'police', other: 'general' };

const memStore = new Map();
const dispatchTimers = new Map();

function getDb() { return getAdmin()?.firestore() || null; }

function calculatePriority(type, subcategory, hasMedia) {
  const base = TYPE_PRIORITY[type] || 5;
  const subBoost = SUBCATEGORY_SEVERITY[subcategory] === 'critical' ? 1.5 : SUBCATEGORY_SEVERITY[subcategory] === 'high' ? 0.5 : 0;
  const mediaBoost = hasMedia ? 0.3 : 0;
  return Math.min(base + subBoost + mediaBoost, 10);
}

function detectSeverity(type, subcategory, description = '') {
  if (SUBCATEGORY_SEVERITY[subcategory]) return SUBCATEGORY_SEVERITY[subcategory];
  const text = `${subcategory} ${description}`.toLowerCase();
  const criticalWords = ['child', 'kidnap', 'no pulse', 'not breathing', 'explosion', 'collapse', 'trapped'];
  const highWords = ['fire', 'flood', 'riot', 'accident', 'injury', 'robbery', 'violence'];
  if (criticalWords.some((w) => text.includes(w))) return 'critical';
  if (highWords.some((w) => text.includes(w)) || ['fire', 'flood', 'police'].includes(type)) return 'high';
  return 'medium';
}

async function findNearestResponders(type, location, count = 2) {
  const db = getDb();
  const responderType = RESPONDER_TYPE[type] || 'general';

  if (!db) {
    // Mock: return first 2 available responders of matching type
    const mockPool = {
      firefighter: ['resp-f1', 'resp-f2'],
      paramedic:   ['resp-m1', 'resp-m2'],
      police:      ['resp-p1', 'resp-p2'],
      rescue:      ['resp-r1', 'resp-r2'],
      general:     ['resp-f1', 'resp-m1'],
    };
    return (mockPool[responderType] || []).slice(0, count);
  }

  try {
    const snap = await db.collection('responders')
      .where('type', '==', responderType)
      .where('status', '==', 'available')
      .where('isOnline', '==', true)
      .limit(10)
      .get();

    const available = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Sort by distance (approximation using lat/lng diff)
    available.sort((a, b) => {
      const da = Math.abs(a.currentLocation?.lat - location.lat) + Math.abs(a.currentLocation?.lng - location.lng);
      const db2 = Math.abs(b.currentLocation?.lat - location.lat) + Math.abs(b.currentLocation?.lng - location.lng);
      return da - db2;
    });

    return available.slice(0, count).map((r) => r.id);
  } catch {
    return [];
  }
}

function buildDispatchChain(responderIds) {
  const now = Date.now();
  return responderIds.map((id, idx) => ({
    responderId: id,
    status: idx === 0 ? 'notified' : 'standby', // Primary is notified, rest are standby
    notifiedAt: now,
    respondedAt: null,
    timeoutAt: idx === 0 ? now + DISPATCH_TIMEOUT_MS : null, // Only primary has timeout
    reason: null,
  }));
}

function scheduleDispatchEscalation(incidentId) {
  const timer = setTimeout(async () => {
    const incident = memStore.get(incidentId);
    if (!incident) return;

    const chain = incident.dispatchChain;
    const primary = chain.findIndex((d) => d.status === 'notified');
    if (primary === -1) return;

    // Auto-decline primary
    chain[primary] = { ...chain[primary], status: 'declined', respondedAt: Date.now(), reason: 'No response — auto-escalated after 30s' };

    // Promote next standby
    const next = chain.findIndex((d, i) => i > primary && d.status === 'standby');
    if (next !== -1) {
      const now = Date.now();
      chain[next] = { ...chain[next], status: 'notified', notifiedAt: now, timeoutAt: now + DISPATCH_TIMEOUT_MS };
      // Schedule next timeout
      scheduleDispatchEscalation(incidentId);
    }

    memStore.set(incidentId, { ...incident, dispatchChain: chain, updatedAt: new Date().toISOString() });

    const db = getDb();
    if (db) {
      db.collection('incidents').doc(incidentId).update({ dispatchChain: chain, updatedAt: new Date().toISOString() }).catch(() => {});
    }

    await broadcastIncidentUpdate(incidentId, { dispatchChain: chain });
  }, DISPATCH_TIMEOUT_MS);

  // Clear old timer if exists
  const old = dispatchTimers.get(incidentId);
  if (old) clearTimeout(old);
  dispatchTimers.set(incidentId, timer);
}

// ─── POST /api/emergency/report ─────────────────────────────────────────────
router.post('/report', emergencyLimiter, auth, async (req, res, next) => {
  try {
    const { type, subcategory, location, description, mediaUrl, userId, severity: clientSeverity } = req.body;

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!location?.lat || !location?.lng) {
      return res.status(400).json({ error: 'location.lat and location.lng are required' });
    }

    const id = `INC-${uuidv4().slice(0, 6).toUpperCase()}`;
    const severity = clientSeverity || detectSeverity(type, subcategory || '', description || '');
    const priorityScore = calculatePriority(type, subcategory || '', !!mediaUrl);
    const now = new Date();

    // Find 2 nearest responders
    const nearestIds = await findNearestResponders(type, location, 2);
    const dispatchChain = buildDispatchChain(nearestIds);

    const incident = {
      id,
      type,
      subcategory: subcategory || type,
      severity,
      location,
      description: (description || '').substring(0, 500),
      mediaUrl: mediaUrl || null,
      reportedBy: userId || req.user.uid,
      assignedTo: nearestIds[0] || null,
      status: nearestIds.length > 0 ? 'pending' : 'pending',
      priorityScore,
      verificationScore: 40,
      aiAnalysis: null,
      peopleAffected: 0,
      dispatchChain,
      zone: 'zone-1',
      timeline: [
        { event: 'reported',    time: now.toISOString(), note: `Citizen SOS — ${subcategory || type}` },
        { event: 'dispatched',  time: now.toISOString(), note: `${nearestIds.length} nearest responders notified (PRIMARY + STANDBY)` },
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      resolvedAt: null,
    };

    const db = getDb();
    if (db) {
      await db.collection('incidents').doc(id).set(incident);
    } else {
      memStore.set(id, incident);
    }

    // Broadcast
    await broadcastNewIncident(incident);

    // Schedule auto-escalation for primary responder
    if (nearestIds.length > 0) {
      scheduleDispatchEscalation(id);
    }

    const estimatedResponseTime = type === 'medical' ? 120 : type === 'fire' ? 180 : 240;

    res.status(201).json({
      success: true,
      incidentId: id,
      severity,
      priorityScore,
      status: incident.status,
      dispatchedTo: nearestIds.length,
      estimatedResponseTime,
      message: `Emergency reported. ${nearestIds.length} responders notified. Primary has 30s to accept.`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/emergency/active ───────────────────────────────────────────────
router.get('/active', auth, async (req, res, next) => {
  try {
    const { type, severity, limit = 20 } = req.query;
    const db = getDb();
    let incidents = [];

    if (db) {
      let q = db.collection('incidents').where('status', '!=', 'resolved').orderBy('status').orderBy('priorityScore', 'desc').limit(parseInt(limit));
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      incidents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      incidents = Array.from(memStore.values())
        .filter((i) => i.status !== 'resolved')
        .filter((i) => !type || i.type === type)
        .filter((i) => !severity || i.severity === severity)
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, parseInt(limit));
    }

    res.json({ success: true, count: incidents.length, incidents });
  } catch (err) { next(err); }
});

// ─── GET /api/emergency/:id ──────────────────────────────────────────────────
router.get('/:id', auth, async (req, res, next) => {
  try {
    const db = getDb();
    let incident = null;
    if (db) {
      const doc = await db.collection('incidents').doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Incident not found' });
      incident = { id: doc.id, ...doc.data() };
    } else {
      incident = memStore.get(req.params.id);
      if (!incident) return res.status(404).json({ error: 'Incident not found' });
    }
    res.json({ success: true, incident });
  } catch (err) { next(err); }
});

// ─── PATCH /api/emergency/:id/dispatch — responder accept/decline ────────────
router.patch('/:id/dispatch', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { responderId, action, reason } = req.body;

    if (!responderId || !['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'responderId and action (accept|decline) required' });
    }

    const db = getDb();
    const now = Date.now();

    const getIncident = async () => {
      if (db) {
        const doc = await db.collection('incidents').doc(id).get();
        return doc.exists ? { id, ...doc.data() } : null;
      }
      return memStore.get(id) || null;
    };

    const incident = await getIncident();
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const chain = [...(incident.dispatchChain || [])];
    const idx = chain.findIndex((d) => d.responderId === responderId);
    if (idx === -1) return res.status(404).json({ error: 'Responder not in dispatch chain' });

    if (action === 'accept') {
      chain[idx] = { ...chain[idx], status: 'accepted', respondedAt: now };
      // Clear timeout — responder accepted
      const timer = dispatchTimers.get(id);
      if (timer) { clearTimeout(timer); dispatchTimers.delete(id); }
    } else {
      chain[idx] = { ...chain[idx], status: 'declined', respondedAt: now, reason: reason || 'Declined' };
      // Escalate to next standby
      const nextIdx = chain.findIndex((d, i) => i > idx && d.status === 'standby');
      if (nextIdx !== -1) {
        chain[nextIdx] = { ...chain[nextIdx], status: 'notified', notifiedAt: now, timeoutAt: now + DISPATCH_TIMEOUT_MS };
        scheduleDispatchEscalation(id);
      }
    }

    // Add timeline entry
    const timelineEntry = {
      event: action,
      time: new Date().toISOString(),
      note: action === 'accept'
        ? `${responderId} accepted mission`
        : `${responderId} declined — ${reason || 'No reason given'}`,
    };

    const updates = {
      dispatchChain: chain,
      updatedAt: new Date().toISOString(),
      timeline: [...(incident.timeline || []), timelineEntry],
    };

    if (db) {
      await db.collection('incidents').doc(id).update(updates);
    } else {
      memStore.set(id, { ...incident, ...updates });
    }

    await broadcastIncidentUpdate(id, { dispatchChain: chain });

    res.json({ success: true, incidentId: id, action, responderId, chain });
  } catch (err) { next(err); }
});

// ─── PATCH /api/emergency/:id/status ────────────────────────────────────────
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, responderId, notes } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const updates = { status, updatedAt: now, ...(responderId && { assignedTo: responderId }), ...(status === 'resolved' && { resolvedAt: now }) };
    const timelineEntry = { event: status, time: now, note: notes || `Status → ${status}` };

    if (db) {
      const admin = getAdmin();
      await db.collection('incidents').doc(id).update({ ...updates, timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry) });
    } else {
      const stored = memStore.get(id);
      if (!stored) return res.status(404).json({ error: 'Incident not found' });
      memStore.set(id, { ...stored, ...updates, timeline: [...(stored.timeline || []), timelineEntry] });
    }

    await broadcastIncidentUpdate(id, updates);

    if (status === 'resolved') {
      const timer = dispatchTimers.get(id);
      if (timer) { clearTimeout(timer); dispatchTimers.delete(id); }
    }

    res.json({ success: true, incidentId: id, status });
  } catch (err) { next(err); }
});

module.exports = router;
