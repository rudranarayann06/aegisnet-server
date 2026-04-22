const { verifyIncident: geminiVerify } = require('./geminiService');
const { getAdmin } = require('../config/firebase');

// Threshold configs per incident type
const CONFIDENCE_THRESHOLDS = {
  fire: 70,
  medical: 60,
  flood: 65,
  other: 75,
};

async function calculateBaseConfidence(incidentData, existingReports = []) {
  let score = 40; // Base score for any single report

  // More reports = higher confidence
  score += Math.min(existingReports.length * 15, 30);

  // Priority boosts
  if (incidentData.mediaUrl) score += 10;
  if (incidentData.location?.accuracy < 50) score += 5; // High GPS accuracy

  // Time-based: recent sensor data
  const minutesOld = (Date.now() - new Date(incidentData.createdAt || Date.now())) / 60000;
  if (minutesOld < 5) score += 5;

  return Math.min(score, 95);
}

async function findCorroboratingReports(incidentId, location, incidentType) {
  const admin = getAdmin();
  if (!admin) return [];

  try {
    const db = admin.firestore();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const snap = await db.collection('incidents')
      .where('type', '==', incidentType)
      .where('status', '!=', 'resolved')
      .where('createdAt', '>=', fiveMinutesAgo)
      .limit(10)
      .get();

    const nearby = snap.docs
      .filter((doc) => doc.id !== incidentId)
      .filter((doc) => {
        const data = doc.data();
        if (!data.location?.lat || !location?.lat) return false;
        const dist = getDistanceKm(
          location.lat, location.lng,
          data.location.lat, data.location.lng
        );
        return dist < 0.5; // Within 500m
      })
      .map((doc) => ({ id: doc.id, ...doc.data() }));

    return nearby;
  } catch {
    return [];
  }
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function verifyIncidentReport(incidentData) {
  const corroborating = await findCorroboratingReports(
    incidentData.id,
    incidentData.location,
    incidentData.type
  );

  const baseConfidence = await calculateBaseConfidence(incidentData, corroborating);
  const threshold = CONFIDENCE_THRESHOLDS[incidentData.type] || 70;

  let aiResult = null;
  try {
    aiResult = await geminiVerify([incidentData, ...corroborating.slice(0, 3)]);
  } catch {
    // Fallback without AI
    aiResult = {
      isVerified: baseConfidence >= threshold,
      confidenceScore: baseConfidence,
      corroboratingFactors: corroborating.length > 0
        ? [`${corroborating.length} nearby reports found`]
        : ['Single report — awaiting corroboration'],
      contradictions: [],
      recommendation: baseConfidence >= threshold
        ? 'Dispatch response unit — confidence threshold met'
        : 'Monitor — insufficient corroboration for auto-dispatch',
      falseAlarmProbability: 100 - baseConfidence,
    };
  }

  return {
    ...aiResult,
    baseConfidence,
    corroboratingReports: corroborating.length,
    threshold,
    autoDispatch: (aiResult.confidenceScore || baseConfidence) >= threshold,
  };
}

module.exports = { verifyIncidentReport };
