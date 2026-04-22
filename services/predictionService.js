const { predictRisk: geminiPredict } = require('./geminiService');
const { getAdmin } = require('../config/firebase');

// Priority scores per type
const TYPE_WEIGHTS = { fire: 9, flood: 8, medical: 7, other: 5 };
const TIME_RISK_MULTIPLIERS = {
  0: 0.6, 1: 0.5, 2: 0.4, 3: 0.4, 4: 0.5, 5: 0.6,
  6: 0.7, 7: 0.9, 8: 1.0, 9: 1.1, 10: 1.1, 11: 1.0,
  12: 1.2, 13: 1.1, 14: 1.0, 15: 1.0, 16: 1.1, 17: 1.2,
  18: 1.3, 19: 1.2, 20: 1.0, 21: 0.9, 22: 0.8, 23: 0.7,
};

function calculateBaseRisk(incidents, hour) {
  if (!incidents?.length) return 20;

  const typeScore = incidents.reduce((sum, inc) => {
    return sum + (TYPE_WEIGHTS[inc.type] || 5) * (inc.priorityScore || 5);
  }, 0);

  const avgScore = typeScore / incidents.length;
  const timeMultiplier = TIME_RISK_MULTIPLIERS[hour] || 1.0;
  const raw = Math.min((avgScore / 90) * 100 * timeMultiplier, 100);

  return Math.round(raw);
}

async function getHistoricalPatterns(zoneId) {
  const admin = getAdmin();
  if (!admin) return null;

  try {
    const db = admin.firestore();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const snap = await db.collection('incidents')
      .where('zone', '==', zoneId)
      .where('createdAt', '>=', yesterday)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const incidents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byHour = {};
    incidents.forEach((inc) => {
      const h = new Date(inc.createdAt?.toDate?.() || inc.createdAt).getHours();
      byHour[h] = (byHour[h] || 0) + 1;
    });

    return { incidents, byHour, total: incidents.length };
  } catch {
    return null;
  }
}

async function generateRiskPrediction(zoneId, currentIncidents, timeOfDay, weatherData) {
  const hour = timeOfDay ?? new Date().getHours();
  const baseRisk = calculateBaseRisk(currentIncidents, hour);
  const historical = await getHistoricalPatterns(zoneId);

  // Weather risk boost
  let weatherBoost = 0;
  if (weatherData) {
    if (weatherData.condition?.includes('rain') || weatherData.condition?.includes('storm')) weatherBoost = 15;
    if (weatherData.visibility < 1000) weatherBoost += 5;
    if (weatherData.wind > 50) weatherBoost += 10;
  }

  const adjustedRisk = Math.min(baseRisk + weatherBoost, 100);

  try {
    const zoneContext = {
      zoneId,
      currentIncidentCount: currentIncidents?.length || 0,
      incidentTypes: [...new Set(currentIncidents?.map((i) => i.type) || [])],
      timeOfDay: hour,
      isBusinessHours: hour >= 9 && hour <= 18,
      isPeakTraffic: (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19),
      weatherData,
      baseRiskScore: adjustedRisk,
      historicalPatterns: historical?.byHour || {},
    };

    const aiResult = await geminiPredict(zoneContext);
    return {
      ...aiResult,
      baseRiskScore: adjustedRisk,
      historicalContext: historical?.total || 0,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    const riskLevel =
      adjustedRisk >= 80 ? 'critical' :
      adjustedRisk >= 60 ? 'high' :
      adjustedRisk >= 40 ? 'medium' : 'low';

    return {
      riskScore: adjustedRisk,
      riskLevel,
      predictedIncidentTypes: currentIncidents?.map((i) => i.type) || ['medical', 'traffic'],
      hotspotCoordinates: [],
      timeToIncident: adjustedRisk > 70 ? '15-30 minutes' : '60-120 minutes',
      preventiveActions: [
        'Maintain current patrol coverage',
        'Ensure medical units are on standby',
        'Monitor traffic at key intersections',
      ],
      confidenceLevel: 65,
      baseRiskScore: adjustedRisk,
      generatedAt: new Date().toISOString(),
    };
  }
}

module.exports = { generateRiskPrediction, calculateBaseRisk };
