const VALID_STATUSES = ['available', 'en-route', 'on-scene', 'off-duty'];
const VALID_ROLES = ['Lead', 'Medical', 'Evacuation', 'Comms'];

function createResponderProfile({ uid, name, email, zone = 'zone-1', skills = [] }) {
  return {
    uid,
    name: name?.trim(),
    email,
    zone,
    currentLocation: null,
    status: 'available',
    activeIncident: null,
    role: null,
    skills: skills.filter((s) => typeof s === 'string'),
    fcmToken: null,
    isOnline: true,
    totalMissions: 0,
    successRate: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validateAssignment({ incidentId, responderId }) {
  const errors = [];
  if (!incidentId) errors.push('incidentId is required');
  if (!responderId) errors.push('responderId is required');
  return errors;
}

module.exports = { createResponderProfile, validateAssignment, VALID_STATUSES, VALID_ROLES };
