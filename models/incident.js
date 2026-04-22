const { v4: uuidv4 } = require('uuid');

const VALID_TYPES = ['fire', 'medical', 'flood', 'other'];
const VALID_STATUSES = ['pending', 'active', 'resolved', 'false_alarm'];

const TYPE_PRIORITY_BASE = { fire: 8, medical: 7, flood: 7, other: 4 };

function calculatePriorityScore(type, reportCount = 1, hasMedia = false) {
  const base = TYPE_PRIORITY_BASE[type] || 5;
  const reportBoost = Math.min(reportCount - 1, 3) * 0.5;
  const mediaBoost = hasMedia ? 0.5 : 0;
  return Math.min(Math.round((base + reportBoost + mediaBoost) * 10) / 10, 10);
}

function getSeverityFromPriority(score) {
  if (score >= 8) return 'critical';
  if (score >= 6) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function createIncident({
  type,
  location,
  description = '',
  mediaUrl = null,
  userId,
  zone = 'zone-1',
}) {
  const id = `inc-${uuidv4().slice(0, 8)}`;
  const priorityScore = calculatePriorityScore(type, 1, !!mediaUrl);
  const severity = getSeverityFromPriority(priorityScore);
  const now = new Date();

  return {
    id,
    type,
    severity,
    location,
    description,
    mediaUrl,
    reportedBy: userId,
    assignedTo: null,
    status: 'pending',
    priorityScore,
    verificationScore: 0,
    aiAnalysis: null,
    peopleAffected: 0,
    zone,
    timeline: [
      {
        event: 'reported',
        timestamp: now.toISOString(),
        actor: userId,
        note: 'Incident reported by citizen',
      },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    resolvedAt: null,
  };
}

function validateIncidentInput(data) {
  const errors = [];

  if (!data.type || !VALID_TYPES.includes(data.type)) {
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (!data.location || typeof data.location.lat !== 'number' || typeof data.location.lng !== 'number') {
    errors.push('location must have numeric lat and lng');
  }

  if (!data.userId) {
    errors.push('userId is required');
  }

  return errors;
}

function validateStatusUpdate(data) {
  const errors = [];

  if (!data.status || !VALID_STATUSES.includes(data.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return errors;
}

module.exports = {
  createIncident,
  validateIncidentInput,
  validateStatusUpdate,
  calculatePriorityScore,
  getSeverityFromPriority,
  VALID_TYPES,
  VALID_STATUSES,
};
