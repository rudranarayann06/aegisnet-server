const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const geminiService = require('../services/geminiService');
const { getAdmin } = require('../config/firebase');

// Apply AI rate limiter to all routes in this router
router.use(aiLimiter);
router.use(auth);

// POST /api/ai/chat
router.post('/chat', async (req, res, next) => {
  try {
    const { message, userId, context } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }

    const safeMessage = message.substring(0, 500);
    const response = await geminiService.chatWithAI(safeMessage, context || {});

    // Log conversation asynchronously
    const db = getAdmin()?.firestore();
    if (db) {
      db.collection('conversations').add({
        userId: userId || req.user.uid,
        message: safeMessage,
        response: response.substring(0, 2000),
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    }

    res.json({ success: true, response, timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/chat-stream (SSE streaming)
router.post('/chat-stream', async (req, res, next) => {
  try {
    const { message, userId, context } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const safeMessage = message.substring(0, 500);

    await geminiService.streamChatWithAI(
      safeMessage,
      context || {},
      (chunk) => {
        res.write(`data: ${chunk}\n\n`);
        if (res.flush) res.flush();
      }
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      res.write(`data: [ERROR] ${err.message}\n\n`);
      res.end();
    }
  }
});

// POST /api/ai/analyze-incident
router.post('/analyze-incident', async (req, res, next) => {
  try {
    const { incidentId, incidentData } = req.body;

    if (!incidentData || typeof incidentData !== 'object') {
      return res.status(400).json({ error: 'incidentData object is required' });
    }

    const analysis = await geminiService.analyzeIncident(incidentData);

    // Store analysis on incident
    if (incidentId) {
      const db = getAdmin()?.firestore();
      if (db) {
        db.collection('incidents').doc(incidentId).update({
          aiAnalysis: analysis,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    res.json({ success: true, ...analysis, analyzedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/predict-risk
router.post('/predict-risk', async (req, res, next) => {
  try {
    const { zoneId, currentIncidents, timeOfDay, weatherData } = req.body;

    if (!zoneId) {
      return res.status(400).json({ error: 'zoneId is required' });
    }

    const { generateRiskPrediction } = require('../services/predictionService');
    const prediction = await generateRiskPrediction(
      zoneId,
      currentIncidents || [],
      timeOfDay,
      weatherData
    );

    res.json({ success: true, ...prediction });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/verify-incident
router.post('/verify-incident', async (req, res, next) => {
  try {
    const { incidentId, reports } = req.body;

    if (!reports || !Array.isArray(reports) || reports.length === 0) {
      return res.status(400).json({ error: 'reports array is required' });
    }

    const result = await geminiService.verifyIncident(reports);

    // Update incident with verification score
    if (incidentId) {
      const db = getAdmin()?.firestore();
      if (db) {
        db.collection('incidents').doc(incidentId).update({
          verificationScore: result.confidenceScore,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    res.json({ success: true, ...result, verifiedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/simulate-crisis
router.post('/simulate-crisis', async (req, res, next) => {
  try {
    const { scenario, location, peopleCount } = req.body;

    if (!scenario) {
      return res.status(400).json({ error: 'scenario is required' });
    }

    const simulation = await geminiService.simulateCrisis({
      scenario,
      location: location || 'Unknown',
      peopleCount: Math.min(parseInt(peopleCount) || 100, 10000),
    });

    res.json({ success: true, ...simulation, simulatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/post-crisis-learn
router.post('/post-crisis-learn', async (req, res, next) => {
  try {
    const { incidentId, responseData } = req.body;

    if (!responseData || typeof responseData !== 'object') {
      return res.status(400).json({ error: 'responseData object is required' });
    }

    const learning = await geminiService.postCrisisLearn(responseData);

    // Store learning
    if (incidentId) {
      const db = getAdmin()?.firestore();
      if (db) {
        db.collection('incidents').doc(incidentId).update({
          postCrisisAnalysis: learning,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    res.json({ success: true, ...learning, learnedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
