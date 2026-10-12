// ============================================================
// api/config.js
// Complete Vercel Project Configuration
// OpenAI + Firebase
// ============================================================

const OPENAI_API_KEY =
    process.env.OPENAI_API_KEY || "";

const OPENAI_CHAT_MODEL =
    process.env.OPENAI_CHAT_MODEL ||
    "gpt-4o-mini";

const OPENAI_TTS_MODEL =
    process.env.OPENAI_TTS_MODEL ||
    "gpt-4o-mini-tts";

const OPENAI_TTS_VOICE =
    process.env.OPENAI_TTS_VOICE ||
    "alloy";

const LEMON_WEBHOOK_SIGNING_SECRET =
    process.env.LEMON_WEBHOOK_SIGNING_SECRET || "";

const LEMON_SQUEEZY_API_KEY =
    process.env.LEMON_SQUEEZY_API_KEY || "";

const LEMON_SQUEEZY_STORE_ID =
    process.env.LEMON_SQUEEZY_STORE_ID || "";

const LEMON_VARIANT_15_DAYS =
    process.env.LEMON_VARIANT_15_DAYS || "";

const LEMON_VARIANT_7_DAYS =
    process.env.LEMON_VARIANT_7_DAYS || "";

const LEMON_VARIANT_30_DAYS =
    process.env.LEMON_VARIANT_30_DAYS || "";

const LEMON_VARIANT_90_DAYS =
    process.env.LEMON_VARIANT_90_DAYS || "";

const LEMON_VARIANT_1_YEAR =
    process.env.LEMON_VARIANT_1_YEAR || "";

const LEMON_VARIANT_3_YEARS =
    process.env.LEMON_VARIANT_3_YEARS || "";

const CRON_SECRET =
    process.env.CRON_SECRET || "";


// ============================================================
// Firebase Admin Configuration
// ============================================================

const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    "ai-article-b3954";

const FIREBASE_CLIENT_EMAIL =
    process.env.FIREBASE_CLIENT_EMAIL || "";

const FIREBASE_PRIVATE_KEY =
    process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(
            /\\n/g,
            "\n"
        )
        : "";


// ============================================================
// Configuration Status
// ============================================================

const config = {

    openai: {

        apiKey:
            OPENAI_API_KEY,

        chatModel:
            OPENAI_CHAT_MODEL,

        ttsModel:
            OPENAI_TTS_MODEL,

        ttsVoice:
            OPENAI_TTS_VOICE

    },

    firebase: {

        projectId:
            FIREBASE_PROJECT_ID,

        clientEmail:
            FIREBASE_CLIENT_EMAIL,

        privateKey:
            FIREBASE_PRIVATE_KEY

    },

    lemonSqueezy: {

        webhookSigningSecret:
            LEMON_WEBHOOK_SIGNING_SECRET,

        variant15Days:
            LEMON_VARIANT_15_DAYS,

        variant30Days:
            LEMON_VARIANT_30_DAYS,

        variant90Days:
            LEMON_VARIANT_90_DAYS,

        variant1Year:
            LEMON_VARIANT_1_YEAR,

        variant3Years:
            LEMON_VARIANT_3_YEARS

    }

};


// ============================================================
// Validation Helpers
// ============================================================

function hasOpenAIConfig() {

    return Boolean(
        OPENAI_API_KEY
    );

}


function hasFirebaseConfig() {

    return Boolean(
        FIREBASE_PROJECT_ID &&
        FIREBASE_CLIENT_EMAIL &&
        FIREBASE_PRIVATE_KEY
    );

}


// ============================================================
// Export
// ============================================================

module.exports = {

    config,

    OPENAI_API_KEY,
    OPENAI_CHAT_MODEL,
    OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE,

    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,

    LEMON_WEBHOOK_SIGNING_SECRET,
    LEMON_SQUEEZY_API_KEY,
    LEMON_SQUEEZY_STORE_ID,
    LEMON_VARIANT_15_DAYS,
    LEMON_VARIANT_7_DAYS,
    LEMON_VARIANT_30_DAYS,
    LEMON_VARIANT_90_DAYS,
    LEMON_VARIANT_1_YEAR,
    LEMON_VARIANT_3_YEARS,
    CRON_SECRET,

    hasOpenAIConfig,
    hasFirebaseConfig

};