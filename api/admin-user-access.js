const { requireAuthenticatedUser, setUserAccessDisabled } = require("./_lib");
const { checkRateLimit } = require("./_rate-limit");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed." });
    }

    const rate = checkRateLimit(req, {
        action: "admin-user-access",
        limit: 30,
        windowMs: 60 * 1000
    });
    if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        return res.status(429).json({ error: "Too many account-access changes." });
    }

    let admin;
    try {
        admin = await requireAuthenticatedUser(req);
    } catch (error) {
        return res.status(error.statusCode || 401).json({ error: "Authentication required." });
    }

    if (admin.admin !== true) {
        return res.status(403).json({ error: "Admin access required." });
    }

    const uid = typeof req.body?.uid === "string" ? req.body.uid.trim() : "";
    const disabled = req.body?.disabled;
    if (!uid || uid.length > 128 || typeof disabled !== "boolean") {
        return res.status(400).json({ error: "A valid user ID and disabled state are required." });
    }
    if (uid === admin.uid) {
        return res.status(400).json({ error: "You cannot suspend your own admin account." });
    }

    try {
        await setUserAccessDisabled(uid, disabled);
        return res.status(200).json({ success: true, uid, disabled });
    } catch (error) {
        console.error("Admin user-access update failed:", {
            code: error.code || "unknown",
            statusCode: error.statusCode || null,
            message: error.message || "Account access update failed."
        });
        return res.status(error.statusCode || 503).json({
            error: "Could not update account access."
        });
    }
};