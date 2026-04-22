const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { emergencyLimiter } = require('../middleware/rateLimiter');
const { createIncident, validateIncidentInput, validateStatusUpdate } = require('../models/incident');
const { verifyIncidentReport } = require('../services/verificationService');
const { broadcastNewIncident, broadcastIncidentUpdate, notifyResponder } = require('../services/notificationService');
const { postCrisisLearn } = require('../services/geminiService');
const { getAdmin } = require('../config/firebase');

// In-memory fallback store when Firebase is unavailable (dev mode)
const memStore = new Map();

function getDb() {
  const admin = getAdmin();
  return admin ? admin.firestore() : null;
}

// POST /api/emergency/report
router.post('/report', emergencyLimiter, auth, async (req, res, next) => {
  try {
    const { type, location, description, mediaUrl, userId } = req.body;

    const validationErrors = validateIncidentInput({ type, location, userId: userId || req.user.uid });
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const incident = createIncident({
      type,
      location,
      description: description?.substring(0, 500) || '',
      mediaUrl: mediaUrl || null,
      userId: userId || req.user.uid,
    });

    const db = getDb();
    if (db) {
      await db.collection('incidents').doc(incident.id).set(incident);
    } else {
      memStore.set(incident.id, incident);
    }

    // Broadcast to all connected clients
    await broadcastNewIncident(incident);

    // Run verification in background (don't block response)
    verifyIncidentReport(incident).then(async (verification) => {
      const updates = {
        verificationScore: verification.confidenceScore,
        updatedAt: new Date().toISOString(),
      };
      if (db) {
        await db.collection('incidents').doc(incident.id).update(updates);
      } else {
        const stored = memStore.get(incident.id);
        if (stored) memStore.set(incident.id, { ...stored, ...updates });
      }
      await broadcastIncidentUpdate(incident.id, updates);
    }).catch(() => {});

    const estimatedResponseTime = type === 'fire' ? 180 : type === 'medical' ? 240 : 300;

    res.status(201).json({
      success: true,
      incidentId: incident.id,
      status: incident.status,
      estimatedResponseTime,
      message: 'Emergency reported successfully. Responders are being notified.',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/emergency/active
router.get('/active', auth, async (req, res, next) => {
  try {
    const { type, severity, limit = 20 } = req.query;
    const db = getDb();

    let incidents = [];

    if (db) {
      let query = db.collection('incidents').where('status', '!=', 'resolved');
      if (type) query = query.where('type', '==', type);
      if (severity) query = query.where('severity', '==', severity);
      query = query.orderBy('status').orderBy('priorityScore', 'desc').limit(parseInt(limit));

      const snap = await query.get();
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
  } catch (err) {
    next(err);
  }
});

// GET /api/emergency/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    let incident = null;
    if (db) {
      const doc = await db.collection('incidents').doc(id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Incident not found' });
      incident = { id: doc.id, ...doc.data() };
    } else {
      incident = memStore.get(id);
      if (!incident) return res.status(404).json({ error: 'Incident not found' });
    }

    res.json({ success: true, incident });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/emergency/:id/status
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, responderId, notes } = req.body;

    const validationErrors = validateStatusUpdate({ status });
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const db = getDb();
    const now = new Date().toISOString();

    const updates = {
      status,
      updatedAt: now,
      ...(responderId && { assignedTo: responderId }),
      ...(status === 'resolved' && { resolvedAt: now }),
    };

    // Append to timeline
    const timelineEntry = {
      event: status,
      timestamp: now,
      actor: responderId || req.user.uid,
      note: notes || `Status updated to ${status}`,
    };

    if (db) {
      const admin = getAdmin();
      await db.collection('incidents').doc(id).update({
        ...updates,
        timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry),
      });
    } else {
      const stored = memStore.get(id);
      if (!stored) return res.status(404).json({ error: 'Incident not found' });
      memStore.set(id, {
        ...stored,
        ...updates,
        timeline: [...(stored.timeline || []), timelineEntry],
      });
    }

    // Notify responder
    if (responderId && status === 'active') {
      const incident = db
        ? await db.collection('incidents').doc(id).get().then((d) => d.data())
        : memStore.get(id);
      await notifyResponder(responderId, { ...incident, id });
    }

    // Broadcast update
    await broadcastIncidentUpdate(id, updates);

    // Trigger post-crisis learning asynchronously
    if (status === 'resolved') {
      const incident = db
        ? await db.collection('incidents').doc(id).get().then((d) => ({ id, ...d.data() }))
        : { id, ...memStore.get(id) };

      postCrisisLearn(incident).then(async (learning) => {
        if (db) {
          await db.collection('incidents').doc(id).update({ postCrisisAnalysis: learning });
        }
      }).catch(() => {});
    }

    res.json({ success: true, incidentId: id, status, message: 'Incident status updated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/emergency/:id (admin only)
router.delete('/:id', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const db = getDb();

    if (db) {
      await db.collection('incidents').doc(id).delete();
    } else {
      memStore.delete(id);
    }

    res.json({ success: true, message: 'Incident deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
