// ============================================================
// api/chat.js
// Vercel Serverless API
// OpenAI Chat Endpoint
// POST /api/chat
// ============================================================

const {
    generateOpenAIText,
    cleanText,
    limitResponseWords,
    requireAuthenticatedUser,
    checkChatQuestionAccess,
    consumeChatQuestion
} = require("./_lib");


// ============================================================
// Main Handler
// ============================================================

module.exports = async function handler(req, res) {

    // --------------------------------------------------------
    // Only POST allowed
    // --------------------------------------------------------

    if (req.method !== "POST") {

        return res
            .status(405)
            .json({
                error: "Method not allowed."
            });

    }

    let user;

    try {

        user =
            await requireAuthenticatedUser(req);

    } catch (error) {

        return res
            .status(error.statusCode || 401)
            .json({
                error: "اس feature کے لیے login ضروری ہے۔"
            });

    }

    // --------------------------------------------------------
    // Get message
    // --------------------------------------------------------

    const message =
        cleanText(
            req.body?.message
        );


    // --------------------------------------------------------
    // Validate message
    // --------------------------------------------------------

    if (!message) {

        return res
            .status(400)
            .json({
                error: "Message is required."
            });

    }


    // --------------------------------------------------------
    // Message length limit
    // --------------------------------------------------------

    if (message.length > 12000) {

        return res
            .status(400)
            .json({
                error: "Message بہت لمبا ہے۔"
            });

    }

    let access;

    try {

        access =
            await checkChatQuestionAccess(user.uid);

    } catch (error) {

        console.error("Question access check failed:", {
            code: error.code || "unknown",
            statusCode: error.statusCode || null,
            message: error.message || "Quota access check failed."
        });

        return res
            .status(error.statusCode || 503)
            .json({
                error: error.statusCode === 403
                    ? "اس اکاؤنٹ کے لیے رسائی بند ہے۔"
                    : "سوال کا access verify نہیں ہو سکا۔"
            });

    }

    if (!access.allowed) {

        return res
            .status(429)
            .json({
                error:
                    access.reason === "PREMIUM_DAILY_LIMIT"
                        ? "آپ کے آج کے 200 premium سوال مکمل ہو گئے ہیں۔ کل دوبارہ کوشش کریں۔"
                        : "آپ کے 5 free سوال مکمل ہو گئے ہیں۔ مزید سوالات کے لیے subscription فعال کریں۔",
                code:
                    access.reason ||
                    "FREE_LIMIT_REACHED"
            });

    }


    // --------------------------------------------------------
    // OpenAI
    // --------------------------------------------------------

    try {

        const reply =
            await generateOpenAIText({

                systemPrompt:
                    `
                    آپ ایک helpful AI assistant ہیں۔

                    ${access.isPremium
                        ? "Premium صارف کے جواب کو 1000 الفاظ تک رکھا جا سکتا ہے۔"
                        : "Free صارف کا ہر جواب 100 الفاظ سے کم رکھیں۔"}
                    مختصر، واضح اور براہ راست جواب دیں۔

                    آپ online earning,
                    freelancing,
                    digital skills,
                    online business اور
                    website articles کے بارے میں
                    beginner-friendly جواب دیتے ہیں۔

                    آسان اردو یا Roman Urdu استعمال کریں۔

                    Guaranteed income یا جھوٹے دعوے نہ کریں۔

                    جہاں مناسب ہو numbered steps استعمال کریں۔
                    `,

                    userPrompt:
                    message,

                maxOutputTokens:
                    access.isPremium ? 1600 : 220

            });

        let chargedAccess;
        try {
            chargedAccess = await consumeChatQuestion(user.uid);
        } catch (error) {
            console.error("Chat quota commit failed:", {
                code: error.code || "unknown",
                statusCode: error.statusCode || null,
                message: error.message || "Quota commit failed."
            });
            return res.status(error.statusCode || 503).json({
                error: error.statusCode === 403
                    ? "اس اکاؤنٹ کے لیے رسائی بند ہے۔"
                    : "جواب تیار ہوا مگر سوال کا حساب محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔"
            });
        }

        if (!chargedAccess.allowed) {
            return res.status(429).json({
                error: chargedAccess.reason === "PREMIUM_DAILY_LIMIT"
                    ? "آپ کے آج کے 200 premium سوال مکمل ہو گئے ہیں۔ کل دوبارہ کوشش کریں۔"
                    : "آپ کے 5 free سوال مکمل ہو گئے ہیں۔ مزید سوالات کے لیے subscription فعال کریں۔",
                code: chargedAccess.reason || "FREE_LIMIT_REACHED"
            });
        }

        const limitedReply = limitResponseWords(
            reply,
            chargedAccess.responseWordLimit
        );


        // ----------------------------------------------------
        // Success
        // ----------------------------------------------------

        return res
            .status(200)
            .json({

                reply: limitedReply,

                source: "openai"

            });


    } catch (error) {

        console.error("Chat API error:", {
            code: error.code || "unknown",
            statusCode: error.statusCode || null,
            message: error.message || "AI generation failed."
        });


        return res
            .status(500)
            .json({

                error: "AI response حاصل نہیں ہو سکا۔"

            });

    }

};