const admin = require("firebase-admin");

let initialized = false;

function initFirebase() {
  if (initialized) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("Firebase Admin not configured");
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  initialized = true;
}

async function verifyFirebaseToken(idToken) {
  initFirebase();
  if (!initialized) {
    throw new Error("Firebase Admin is not configured");
  }
  return admin.auth().verifyIdToken(idToken);
}

module.exports = { verifyFirebaseToken };