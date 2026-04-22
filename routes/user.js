const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createUserProfile, validateProfileUpdate } = require('../models/user');
const { getAdmin } = require('../config/firebase');

function getDb() {
  return getAdmin()?.firestore() || null;
}

// GET /api/user/profile
router.get('/profile', auth, async (req, res, next) => {
  try {
    const db = getDb();
    const uid = req.user.uid;

    if (!db) {
      return res.json({
        success: true,
        user: {
          uid,
          name: 'Dev User',
          email: req.user.email,
          role: req.user.role || 'citizen',
          zone: 'zone-1',
          isOnline: true,
        },
      });
    }

    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({ success: true, user: { uid, ...doc.data() } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/user/profile
router.patch('/profile', auth, async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const updates = req.body;

    const validationErrors = validateProfileUpdate(updates);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const db = getDb();
    const safeUpdates = { ...updates, updatedAt: new Date().toISOString() };

    if (db) {
      await db.collection('users').doc(uid).update(safeUpdates);
    }

    res.json({ success: true, uid, updates: safeUpdates });
  } catch (err) {
    next(err);
  }
});

// POST /api/user/fcm-token
router.post('/fcm-token', auth, async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    const db = getDb();
    if (db) {
      await db.collection('users').doc(req.user.uid).update({
        fcmToken: token,
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: 'FCM token registered' });
  } catch (err) {
    next(err);
  }
});

// GET /api/user/alerts
router.get('/alerts', auth, async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const db = getDb();

    if (!db) {
      return res.json({ success: true, alerts: [], count: 0 });
    }

    // Get incidents in user's zone
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const zone = userDoc.exists ? userDoc.data().zone : 'zone-1';

    const snap = await db.collection('incidents')
      .where('zone', '==', zone)
      .where('status', '!=', 'resolved')
      .orderBy('status')
      .orderBy('priorityScore', 'desc')
      .limit(parseInt(limit))
      .get();

    const alerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, count: alerts.length, alerts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
