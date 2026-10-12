const { requireFirestore, FieldValue } = require("./_lib");
const { checkRateLimit } = require("./_rate-limit");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed." });
    }

    const rate = checkRateLimit(req, {
        action: "site-visits",
        limit: 30,
        windowMs: 60 * 1000
    });

    if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        return res.status(429).json({ error: "Visit limit reached." });
    }

    const path = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!path.startsWith("/") || path.length > 300 || path.startsWith("//")) {
        return res.status(400).json({ error: "A valid page path is required." });
    }

    try {
        await requireFirestore().collection("siteVisits").add({
            path,
            createdAt: FieldValue.serverTimestamp()
        });
        return res.status(202).json({ recorded: true });
    } catch (error) {
        console.error("Site visit write failed:", {
            code: error.code || "unknown",
            message: error.message || "Firestore write failed."
        });
        return res.status(503).json({ error: "Visit tracking is temporarily unavailable." });
    }
};