const admin = require('firebase-admin');

let db = null;
let isInitialized = false;

function initFirebase() {
  if (isInitialized) return;

  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : null;

    if (serviceAccount) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      // Use application default credentials (works on Google Cloud)
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }

    db = admin.firestore();
    isInitialized = true;
  } catch (err) {
    // In development without Firebase, log and continue with mock
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Firebase] Using mock mode — set FIREBASE_SERVICE_ACCOUNT_JSON for real Firebase');
    }
  }
}

initFirebase();

const getDb = () => db;
const getAdmin = () => admin;

module.exports = { getDb, getAdmin, admin };
