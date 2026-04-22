const { getModel } = require('../config/gemini');

async function callGemini(systemPrompt, userPrompt, expectJSON = true) {
  const model = getModel();
  const fullPrompt = `${systemPrompt}\n\nUser Input:\n${userPrompt}`;

  const result = await model.generateContent(fullPrompt);
  const text = result.response.text();

  if (!expectJSON) return text;

  // Strip markdown fences if present
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Attempt to extract JSON object from response
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini returned non-JSON response');
  }
}

async function analyzeIncident(incidentData) {
  const systemPrompt = `You are AegisNet AI Incident Commander. You receive structured emergency data and provide tactical analysis.
Respond ONLY in valid JSON with exactly these keys:
- threatLevel: integer 1-10
- immediateActions: array of strings (3-5 specific actions)
- equipmentNeeded: array of strings (3-5 items)
- estimatedDuration: string (e.g. "30-60 minutes")
- evacuationRadius: integer in meters
- riskAssessment: string (2-3 sentences)
- specialConsiderations: string (local factors, hazards)
No markdown, no explanation. JSON only.`;

  const userPrompt = JSON.stringify(incidentData, null, 2);
  return callGemini(systemPrompt, userPrompt, true);
}

async function predictRisk(zoneData) {
  const systemPrompt = `You are AegisNet Predictive Intelligence Engine. Analyze zone data and predict emergency risk for the next 2 hours.
Respond ONLY in valid JSON with exactly these keys:
- riskScore: integer 0-100
- riskLevel: string one of "low"|"medium"|"high"|"critical"
- predictedIncidentTypes: array of strings (2-4 types)
- hotspotCoordinates: array of {lat, lng} objects
- timeToIncident: string estimate (e.g. "45-90 minutes")
- preventiveActions: array of strings (3-4 actions)
- confidenceLevel: integer 0-100
No markdown. JSON only.`;

  const userPrompt = JSON.stringify(zoneData, null, 2);
  return callGemini(systemPrompt, userPrompt, true);
}

async function verifyIncident(reports) {
  const systemPrompt = `You are AegisNet Verification Engine. Cross-reference multiple emergency reports and determine legitimacy.
Respond ONLY in valid JSON with exactly these keys:
- isVerified: boolean
- confidenceScore: integer 0-100
- corroboratingFactors: array of strings (2-4 factors)
- contradictions: array of strings (0-3 items, empty array if none)
- recommendation: string (one actionable sentence)
- falseAlarmProbability: integer 0-100
No markdown. JSON only.`;

  const userPrompt = JSON.stringify(reports, null, 2);
  return callGemini(systemPrompt, userPrompt, true);
}

async function simulateCrisis(scenario) {
  const systemPrompt = `You are AegisNet Digital Twin Simulator. Generate a realistic crisis response simulation.
Respond ONLY in valid JSON with exactly these keys:
- phases: array of objects each with {phase: string, duration: string, actions: string[], resources: string}
- totalDuration: string
- casualtyEstimate: string
- evacuationRoute: string
- criticalDecisionPoints: array of strings (3 items)
- successProbability: integer 0-100
Phases should be 4 sequential phases. No markdown. JSON only.`;

  const userPrompt = JSON.stringify(scenario, null, 2);
  return callGemini(systemPrompt, userPrompt, true);
}

async function postCrisisLearn(incidentData) {
  const systemPrompt = `You are AegisNet Learning Engine. Analyze a completed emergency incident response lifecycle.
Respond ONLY in valid JSON with exactly these keys:
- performanceScore: integer 0-100
- bottlenecks: array of strings (2-3 issues identified)
- improvements: array of strings (3-4 specific improvements)
- bestPractices: array of strings (2-3 things done well)
- trainingRecommendations: array of strings (2-3 recommendations)
- timelineAnalysis: string (2-3 sentences analyzing the response timeline)
No markdown. JSON only.`;

  const userPrompt = JSON.stringify(incidentData, null, 2);
  return callGemini(systemPrompt, userPrompt, true);
}

async function chatWithAI(message, context = {}) {
  const systemPrompt = `You are AegisNet, an emergency response AI assistant. Your role is to provide calm, clear, life-saving guidance during crisis situations.

Rules:
- Be concise and action-oriented
- Number your steps clearly
- Use simple language understandable under stress
- Always end with the nearest emergency resource (use context if available)
- Never panic, always reassure
- For medical: remind to call 108 (India ambulance)
- For fire: remind to call 101
- For police/general: remind to call 100 or 112

Context: ${JSON.stringify(context)}`;

  const userPrompt = message;
  return callGemini(systemPrompt, userPrompt, false);
}

async function streamChatWithAI(message, context = {}, onChunk) {
  const model = getModel();
  const systemPrompt = `You are AegisNet, an emergency response AI. Provide calm, step-by-step guidance. Be concise and life-saving focused. Always end with the nearest emergency resource.

Context: ${JSON.stringify(context)}`;

  const fullPrompt = `${systemPrompt}\n\nUser: ${message}\n\nAegisNet:`;

  const result = await model.generateContentStream(fullPrompt);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) onChunk(text);
  }
}

module.exports = {
  analyzeIncident,
  predictRisk,
  verifyIncident,
  simulateCrisis,
  postCrisisLearn,
  chatWithAI,
  streamChatWithAI,
};
