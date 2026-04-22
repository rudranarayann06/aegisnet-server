const VALID_ROLES = ['citizen', 'responder', 'admin'];

function createUserProfile({ uid, name, email, role = 'citizen', zone = 'zone-1' }) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  return {
    uid,
    name: name?.trim() || 'Unknown User',
    email,
    role,
    zone,
    fcmToken: null,
    location: null,
    isOnline: true,
    profilePic: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validateProfileUpdate(data) {
  const errors = [];
  const allowed = ['name', 'zone', 'fcmToken', 'location', 'isOnline', 'profilePic'];

  const invalid = Object.keys(data).filter((k) => !allowed.includes(k));
  if (invalid.length > 0) {
    errors.push(`Invalid fields: ${invalid.join(', ')}`);
  }

  if (data.name && data.name.trim().length < 2) {
    errors.push('name must be at least 2 characters');
  }

  return errors;
}

module.exports = { createUserProfile, validateProfileUpdate, VALID_ROLES };
