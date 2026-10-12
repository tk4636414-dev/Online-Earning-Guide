const {
    requireAuthenticatedUser
} = require("./_lib");
const {
    LEMON_SQUEEZY_API_KEY,
    LEMON_SQUEEZY_STORE_ID,
    LEMON_VARIANT_7_DAYS,
    LEMON_VARIANT_30_DAYS,
    LEMON_VARIANT_1_YEAR
} = require("./config");
const { checkRateLimit } = require("./_rate-limit");

const PLAN_VARIANTS = {
    weekly: LEMON_VARIANT_7_DAYS,
    monthly: LEMON_VARIANT_30_DAYS,
    annual: LEMON_VARIANT_1_YEAR
};

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed." });
    }

    const rate = checkRateLimit(req, {
        action: "create-checkout",
        limit: 10,
        windowMs: 60 * 1000
    });
    if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        return res.status(429).json({ error: "Too many checkout requests. Try again shortly." });
    }

    let user;
    try {
        user = await requireAuthenticatedUser(req);
    } catch (error) {
        return res.status(error.statusCode || 401).json({ error: "Authentication required." });
    }

    const plan = typeof req.body?.plan === "string" ? req.body.plan : "";
    const variantId = PLAN_VARIANTS[plan];
    if (!variantId) {
        return res.status(400).json({ error: "Choose a valid subscription plan." });
    }
    if (!user.email) {
        return res.status(400).json({ error: "The signed-in account needs an email address." });
    }
    if (!LEMON_SQUEEZY_API_KEY || !LEMON_SQUEEZY_STORE_ID) {
        return res.status(503).json({ error: "Card checkout is not configured." });
    }

    try {
        const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
            method: "POST",
            headers: {
                Accept: "application/vnd.api+json",
                Authorization: `Bearer ${LEMON_SQUEEZY_API_KEY}`,
                "Content-Type": "application/vnd.api+json"
            },
            body: JSON.stringify({
                data: {
                    type: "checkouts",
                    attributes: {
                        checkout_data: {
                            email: user.email,
                            custom: {
                                uid: user.uid,
                                email: user.email
                            }
                        }
                    },
                    relationships: {
                        store: {
                            data: { type: "stores", id: String(LEMON_SQUEEZY_STORE_ID) }
                        },
                        variant: {
                            data: { type: "variants", id: String(variantId) }
                        }
                    }
                }
            })
        });

        const result = await response.json().catch(() => ({}));
        const checkoutUrl = result?.data?.attributes?.url;
        if (!response.ok || typeof checkoutUrl !== "string") {
            console.error("Lemon Squeezy checkout creation failed:", {
                status: response.status,
                code: result?.errors?.[0]?.code || "invalid_response"
            });
            return res.status(502).json({ error: "Could not create card checkout." });
        }

        return res.status(200).json({ checkoutUrl });
    } catch (error) {
        console.error("Checkout request failed:", {
            code: error.code || "unknown",
            message: error.message || "Checkout request failed."
        });
        return res.status(502).json({ error: "Could not create card checkout." });
    }
};