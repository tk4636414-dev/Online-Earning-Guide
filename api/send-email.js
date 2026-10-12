const { Resend } = require("resend");
const { requireAuthenticatedUser } = require("./_lib");

const MAX_EMAIL_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 5000;

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAdminUser(user) {
    if (user.admin === true) {
        return true;
    }

    if (typeof user.email !== "string") {
        return false;
    }

    const allowedAdminEmails = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);

    return allowedAdminEmails.includes(user.email.trim().toLowerCase());
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed." });
    }

    let user;
    try {
        user = await requireAuthenticatedUser(req);
    } catch (error) {
        return res.status(error.statusCode || 401).json({ error: "Authentication required." });
    }

    if (!isAdminUser(user)) {
        return res.status(403).json({ error: "Admin authorization required." });
    }

    const to = cleanString(req.body?.to);
    const subject = cleanString(req.body?.subject);
    const message = cleanString(req.body?.message);

    if (!isValidEmail(to) || to.length > MAX_EMAIL_LENGTH) {
        return res.status(400).json({ error: "A valid recipient email is required." });
    }
    if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
        return res.status(400).json({ error: "Subject is required and must be 180 characters or fewer." });
    }
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: "Message is required and must be 5000 characters or fewer." });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: "Email delivery is not configured." });
    }

    try {
        const resend = new Resend(apiKey);
        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || "Online Earning Guide <onboarding@resend.dev>",
            to,
            subject,
            text: message
        });

        if (error) {
            const errorMessage = typeof error.message === "string" && error.message.trim()
                ? error.message
                : "Email could not be delivered.";
            console.error("Resend delivery failed:", {
                name: error.name,
                message: errorMessage,
                statusCode: error.statusCode,
                details: error
            });
            return res.status(502).json({ error: errorMessage });
        }

        return res.status(200).json({ success: true, id: data?.id || null });
    } catch (error) {
        console.error("Resend request failed:", error);
        const errorMessage = typeof error?.message === "string" && error.message.trim()
            ? error.message
            : "Email could not be delivered.";
        return res.status(502).json({ error: errorMessage });
    }
};