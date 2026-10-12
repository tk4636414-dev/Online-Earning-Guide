// ============================================================
// api/_lib.js
// Complete Vercel Backend Core
// OpenAI + Firebase Admin + Firestore
// ============================================================

const {
    OPENAI_API_KEY,
    OPENAI_CHAT_MODEL,
    OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE,

    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,

    hasOpenAIConfig,
    hasFirebaseConfig,
    LEMON_WEBHOOK_SIGNING_SECRET,
    LEMON_VARIANT_7_DAYS,
    LEMON_VARIANT_15_DAYS,
    LEMON_VARIANT_30_DAYS,
    LEMON_VARIANT_90_DAYS,
    LEMON_VARIANT_1_YEAR,
    LEMON_VARIANT_3_YEARS,
    CRON_SECRET
} = require("./config");


// ============================================================
// Firebase Admin
// ============================================================

const {
    initializeApp,
    cert,
    getApps
} = require("firebase-admin/app");

const {
    getAuth
} = require("firebase-admin/auth");

const {
    getFirestore,
    FieldValue,
    Timestamp
} = require("firebase-admin/firestore");


// ============================================================
// Firebase Initialization
// ============================================================

let firestore = null;
let firebaseAuth = null;

if (FIREBASE_PROJECT_ID) {

    try {

        if (getApps().length === 0) {

            const firebaseOptions = {
                projectId: FIREBASE_PROJECT_ID
            };

            if (hasFirebaseConfig()) {
                firebaseOptions.credential = cert({
                    projectId: FIREBASE_PROJECT_ID,
                    clientEmail: FIREBASE_CLIENT_EMAIL,
                    privateKey: FIREBASE_PRIVATE_KEY
                });
            }

            initializeApp(firebaseOptions);

        }

        firebaseAuth =
            getAuth();

        if (hasFirebaseConfig()) {
            firestore = getFirestore();
        }

    } catch (error) {

        console.error(
            "Firebase initialization failed:",
            error
        );

        firestore = null;
        firebaseAuth = null;

    }

}


// ============================================================
// Text Helper
// ============================================================

function cleanText(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }

    return String(value).trim();

}


// ============================================================
// HTML Helper
// ============================================================

function stripHTMLServer(html) {

    return String(
        html || ""
    )
        .replace(
            /<[^>]*>/g,
            " "
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();

}


// ============================================================
// Article ID
// ============================================================

function createArticleId() {

    return (
        "ai-" +
        Date.now() +
        "-" +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );

}


// ============================================================
// Default Article Title
// ============================================================

function createArticleTitleFallback() {

    return (
        "نیا آن لائن ارننگ اور فری لانسنگ آرٹیکل"
    );

}


// ============================================================
// OpenAI Response Text Extractor
// ============================================================

function extractResponseText(data) {

    if (
        data &&
        typeof data.output_text ===
        "string"
    ) {

        return data.output_text.trim();

    }


    if (
        Array.isArray(
            data?.output
        )
    ) {

        const chunks = [];


        for (
            const item of data.output
        ) {

            if (
                Array.isArray(
                    item?.content
                )
            ) {

                for (
                    const content of item.content
                ) {

                    if (
                        typeof content?.text ===
                        "string"
                    ) {

                        chunks.push(
                            content.text
                        );

                    }

                }

            }

        }


        return chunks
            .join("\n")
            .trim();

    }


    return "";

}


// ============================================================
// OpenAI Text Generation
// ============================================================

async function generateOpenAIText({

    systemPrompt,
    userPrompt,
    maxOutputTokens = 700

}) {

    if (!hasOpenAIConfig()) {

        throw new Error(
            "OpenAI API key configured نہیں ہے۔"
        );

    }


    const response =
        await fetch(
            "https://api.openai.com/v1/responses",
            {

                method:
                    "POST",

                headers: {

                    "Authorization":
                        `Bearer ${OPENAI_API_KEY}`,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        model:
                            OPENAI_CHAT_MODEL,

                        instructions:
                            systemPrompt,

                        input:
                            userPrompt,

                        max_output_tokens:
                            maxOutputTokens

                    })

            }
        );


    let data = null;


    try {

        data =
            await response.json();

    } catch {

        data = null;

    }


    if (!response.ok) {

        console.error("OpenAI API error:", {
            status: response.status,
            code: data?.error?.code || data?.error?.type || "unknown",
            message: data?.error?.message || "OpenAI request failed."
        });

        throw new Error(

            data?.error?.message ||
            "OpenAI request failed."

        );

    }


    const text =
        extractResponseText(
            data
        );


    if (!text) {

        throw new Error(
            "OpenAI نے کوئی text output نہیں دیا۔"
        );

    }


    return text;

}


function limitResponseWords(text, maximumWords) {

    const words =
        String(text || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);

    if (words.length <= maximumWords) {
        return words.join(" ");
    }

    return `${words.slice(0, maximumWords).join(" ")}...`;

}


// ============================================================
// Firebase Availability Check
// ============================================================

function requireFirestore() {

    if (!firestore) {

        throw new Error(
            "Firestore connection available نہیں ہے۔"
        );

    }

    return firestore;

}


async function setUserAccessDisabled(uid, disabled) {
    if (!firebaseAuth) {
        const error = new Error("Firebase Admin Auth is unavailable.");
        error.statusCode = 503;
        throw error;
    }

    if (!firestore) {
        const error = new Error("Firestore is unavailable.");
        error.statusCode = 503;
        throw error;
    }

    await firebaseAuth.updateUser(uid, { disabled });
    if (disabled) {
        await firebaseAuth.revokeRefreshTokens(uid);
    }
    await firestore.collection("users").doc(uid).set({
        accessDisabled: disabled,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
}


async function requireAuthenticatedUser(req) {

    if (!firebaseAuth) {

        const error = new Error(
            "Firebase Admin Auth configured نہیں ہے۔"
        );

        error.statusCode = 503;

        throw error;

    }

    const authorization =
        req.headers?.authorization || "";

    const bearerMatch =
        typeof authorization === "string"
            ? authorization.match(/^Bearer\s+(.+)$/i)
            : null;

    if (!bearerMatch || !bearerMatch[1].trim()) {

        const error =
            new Error("Authentication required.");

        error.statusCode = 401;

        throw error;

    }

    return firebaseAuth.verifyIdToken(
        bearerMatch[1].trim(),
        hasFirebaseConfig()
    );

}


async function requirePremiumUser(req) {

    const user =
        await requireAuthenticatedUser(req);

    const database =
        requireFirestore();

    const snapshot =
        await database.collection("users")
            .doc(user.uid)
            .get();

    const data =
        snapshot.exists
            ? snapshot.data()
            : {};

    const expiryDate =
        data.subscriptionEndsAt?.toDate?.() ||
        null;

    const active =
        (
            data.isPremium === true ||
            data.subscription === "active"
        ) &&
        data.accessDisabled !== true &&
        expiryDate &&
        expiryDate.getTime() > Date.now();

    if (!active) {

        const error =
            new Error("Premium subscription required.");

        error.statusCode = 403;

        throw error;

    }

    return {
        user,
        data,
        expiryDate
    };

}


async function requireArticleGenerationAccess(req) {

    const crypto =
        require("crypto");

    const authorization =
        req.headers.authorization || "";

    const headerSecret =
        req.headers["x-cron-secret"] ||
        "";

    const bearerSecret =
        authorization.startsWith("Bearer ")
            ? authorization.slice(7)
            : "";

    const providedSecret =
        headerSecret ||
        bearerSecret;

    const secretsMatch =
        CRON_SECRET &&
        providedSecret &&
        Buffer.byteLength(providedSecret) ===
            Buffer.byteLength(CRON_SECRET) &&
        crypto.timingSafeEqual(
            Buffer.from(providedSecret),
            Buffer.from(CRON_SECRET)
        );

    if (
        req.method === "GET" &&
        secretsMatch
    ) {

        return {
            type: "cron"
        };

    }

    if (
        req.method === "GET" &&
        headerSecret
    ) {

        const error =
            new Error("Invalid Cron secret.");

        error.statusCode = 401;

        throw error;

    }

    const user =
        await requireAuthenticatedUser(req);

    if (user.admin !== true) {

        const error =
            new Error("Admin access required.");

        error.statusCode = 403;

        throw error;

    }

    return {
        type: "admin",
        user
    };

}


async function checkChatQuestionAccess(uid) {
    const snapshot = await requireFirestore()
        .collection("users")
        .doc(uid)
        .get();
    const userData = snapshot.exists ? snapshot.data() : {};

    if (userData.accessDisabled === true) {
        const error = new Error("Account access has been disabled.");
        error.statusCode = 403;
        throw error;
    }

    const expiryDate = userData.subscriptionEndsAt?.toDate?.() || null;
    const subscriptionIsActive = Boolean(
        expiryDate && expiryDate.getTime() > Date.now()
    );
    const isPremium = (
        userData.isPremium === true || userData.subscription === "active"
    ) && subscriptionIsActive;
    const today = new Date().toISOString().slice(0, 10);
    const questionsAsked = Number(userData.questionsAsked || 0);
    const dailyQuestionsAsked = userData.dailyQuestionDate === today
        ? Number(userData.dailyQuestionsAsked || 0)
        : 0;

    if (!isPremium && questionsAsked >= 5) {
        return { allowed: false, isPremium: false, reason: "FREE_LIMIT" };
    }

    if (isPremium && dailyQuestionsAsked >= 200) {
        return { allowed: false, isPremium: true, reason: "PREMIUM_DAILY_LIMIT" };
    }

    return {
        allowed: true,
        isPremium,
        responseWordLimit: isPremium ? 1000 : 100
    };
}


async function consumeChatQuestion(uid) {

    const database =
        requireFirestore();

    const userRef =
        database.collection("users").doc(uid);

    return database.runTransaction(
        async transaction => {

            const snapshot =
                await transaction.get(userRef);

            const userData =
                snapshot.exists
                    ? snapshot.data()
                    : {};

            if (userData.accessDisabled === true) {
                const error = new Error("Account access has been disabled.");
                error.statusCode = 403;
                throw error;
            }

            const subscriptionEndsAt =
                userData.subscriptionEndsAt;

            const expiryDate =
                subscriptionEndsAt?.toDate?.() ||
                null;

            const subscriptionIsActive =
                Boolean(
                    expiryDate &&
                    expiryDate.getTime() > Date.now()
                );

            const isPremium =
                (
                    userData.isPremium === true ||
                    userData.subscription === "active"
                ) && subscriptionIsActive;

            if (!isPremium && (
                userData.isPremium === true ||
                userData.subscription === "active"
            )) {

                transaction.set(
                    userRef,
                    {
                        isPremium: false,
                        subscription: "expired",
                        updatedAt:
                            FieldValue.serverTimestamp()
                    },
                    { merge: true }
                );

            }

            const questionsAsked =
                Number(userData.questionsAsked || 0);

            const today =
                new Date()
                    .toISOString()
                    .slice(0, 10);

            const dailyQuestionDate =
                userData.dailyQuestionDate ||
                today;

            const dailyQuestionsAsked =
                dailyQuestionDate === today
                    ? Number(
                        userData.dailyQuestionsAsked ||
                        0
                    )
                    : 0;

            if (!isPremium && questionsAsked >= 5) {

                return {
                    allowed: false,
                    isPremium: false,
                    questionsAsked,
                    responseWordLimit: 100,
                    reason: "FREE_LIMIT"
                };

            }

            if (isPremium && dailyQuestionsAsked >= 200) {

                return {
                    allowed: false,
                    isPremium: true,
                    dailyQuestionsAsked,
                    responseWordLimit: 1000,
                    reason: "PREMIUM_DAILY_LIMIT"
                };

            }

            const update =
                isPremium
                    ? {
                        uid,
                        dailyQuestionsAsked:
                            dailyQuestionsAsked + 1,
                        dailyQuestionDate: today,
                        updatedAt:
                            FieldValue.serverTimestamp()
                    }
                    : {
                        uid,
                        questionsAsked:
                            questionsAsked + 1,
                        updatedAt:
                            FieldValue.serverTimestamp()
                    };

            transaction.set(
                userRef,
                update,
                { merge: true }
            );

            return {
                allowed: true,
                isPremium,
                questionsAsked:
                    questionsAsked + 1,
                dailyQuestionsAsked:
                    dailyQuestionsAsked + 1,
                responseWordLimit:
                    isPremium ? 1000 : 100
            };

        }
    );

}


function getPlanFromVariant(variantId) {

    const variant =
        String(variantId || "");

    const plans = [
        {
            id: LEMON_VARIANT_7_DAYS,
            name: "7_days",
            days: 7
        },
        {
            id: LEMON_VARIANT_15_DAYS,
            name: "15_days",
            days: 15
        },
        {
            id: LEMON_VARIANT_30_DAYS,
            name: "30_days",
            days: 30
        },
        {
            id: LEMON_VARIANT_90_DAYS,
            name: "90_days",
            days: 90
        },
        {
            id: LEMON_VARIANT_1_YEAR,
            name: "1_year",
            days: 365
        },
        {
            id: LEMON_VARIANT_3_YEARS,
            name: "3_years",
            days: 1095
        }
    ];

    return plans.find(
        plan => plan.id && plan.id === variant
    ) || null;

}


function calculateSubscriptionExpiry(days, startDate = new Date()) {

    const expiry =
        new Date(startDate);

    expiry.setUTCDate(
        expiry.getUTCDate() + days
    );

    return Timestamp.fromDate(expiry);

}


function verifyLemonSignature(rawBody, signature) {

    const crypto = require("crypto");

    if (
        !LEMON_WEBHOOK_SIGNING_SECRET ||
        !signature ||
        !rawBody
    ) return false;

    const expected =
        crypto
            .createHmac(
                "sha256",
                LEMON_WEBHOOK_SIGNING_SECRET
            )
            .update(rawBody)
            .digest("hex");

    const expectedBuffer =
        Buffer.from(expected, "utf8");

    const receivedBuffer =
        Buffer.from(String(signature), "utf8");

    return expectedBuffer.length ===
        receivedBuffer.length &&
        crypto.timingSafeEqual(
            expectedBuffer,
            receivedBuffer
        );

}


async function findUserUid({ uid, email }) {

    if (uid) return String(uid);

    if (!email || !firebaseAuth) return null;

    try {

        const userRecord =
            await firebaseAuth.getUserByEmail(
                String(email).trim().toLowerCase()
            );

        return userRecord.uid;

    } catch (error) {

        if (error.code !== "auth/user-not-found") {
            console.error("User lookup error:", error);
        }

        return null;

    }

}


async function verifyFirebasePaymentUser({ uid, email }) {

    if (!uid || !email || !firebaseAuth) return null;

    try {

        const userRecord =
            await firebaseAuth.getUser(
                String(uid)
            );

        const firebaseEmail =
            String(userRecord.email || "")
                .trim()
                .toLowerCase();

        const paymentEmail =
            String(email)
                .trim()
                .toLowerCase();

        return firebaseEmail &&
            firebaseEmail === paymentEmail
            ? userRecord
            : null;

    } catch (error) {

        console.error(
            "Payment user verification error:",
            error
        );

        return null;

    }

}


// ============================================================
// Export
// ============================================================

module.exports = {

    // OpenAI
    OPENAI_API_KEY,
    OPENAI_CHAT_MODEL,
    OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE,

    // Firebase
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,

    firestore,
    FieldValue,

    // Helpers
    cleanText,
    stripHTMLServer,
    createArticleId,
    createArticleTitleFallback,
    extractResponseText,
    limitResponseWords,

    // OpenAI
    generateOpenAIText,

    // Firebase
    requireFirestore,
    setUserAccessDisabled,
    requireAuthenticatedUser,
    requirePremiumUser,
    requireArticleGenerationAccess,
    checkChatQuestionAccess,
    consumeChatQuestion,
    getPlanFromVariant,
    calculateSubscriptionExpiry,
    verifyLemonSignature,
    findUserUid,
    verifyFirebasePaymentUser,

    // Config checks
    hasOpenAIConfig,
    hasFirebaseConfig

};