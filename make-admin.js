require("dotenv").config();

const { cert, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const email = process.argv[2] || process.env.ADMIN_EMAIL;

if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in the environment.");
}

if (!email) {
    throw new Error("Pass an admin email as the first argument or set ADMIN_EMAIL.");
}

initializeApp({
    credential: cert({ projectId, clientEmail, privateKey })
});

const auth = getAuth();

auth.getUserByEmail(email)
    .then((user) => auth.setCustomUserClaims(user.uid, {
        ...(user.customClaims || {}),
        admin: true
    }).then(() => user.uid))
    .then((uid) => auth.getUser(uid))
    .then((user) => {
        console.log(`Successfully set admin custom claim for ${email} (UID: ${user.uid})`);
        console.log("Stored custom claims:", user.customClaims || {});
    })
    .catch((error) => {
        console.error("Failed to set admin custom claim:", {
            code: error.code || "unknown",
            message: error.message || "Unexpected Firebase Admin error."
        });
        process.exitCode = 1;
    });