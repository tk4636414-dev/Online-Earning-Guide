const nodemailer = require("nodemailer");
const { checkRateLimit } = require("./_rate-limit");

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 5000;

function cleanValue(value) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed."
        });
    }

    const rate = checkRateLimit(req, {
        action: "contact",
        limit: 5,
        windowMs: 10 * 60 * 1000
    });

    if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        return res.status(429).json({ error: "بہت زیادہ درخواستیں بھیجی گئی ہیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔" });
    }

    const name = cleanValue(req.body?.name);
    const email = cleanValue(req.body?.email);
    const subject = cleanValue(req.body?.subject);
    const message = cleanValue(req.body?.message);
    const fieldErrors = {};

    if (!name) fieldErrors.name = "نام درج کریں۔";
    if (!email || !isValidEmail(email)) {
        fieldErrors.email = "درست ای میل درج کریں۔";
    }
    if (!subject) fieldErrors.subject = "عنوان درج کریں۔";
    if (!message) fieldErrors.message = "پیغام درج کریں۔";

    if (name.length > MAX_NAME_LENGTH) {
        fieldErrors.name = "نام بہت لمبا ہے۔";
    }
    if (email.length > MAX_EMAIL_LENGTH) {
        fieldErrors.email = "ای میل بہت لمبی ہے۔";
    }
    if (subject.length > MAX_SUBJECT_LENGTH) {
        fieldErrors.subject = "عنوان بہت لمبا ہے۔";
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        fieldErrors.message = "پیغام بہت لمبا ہے۔";
    }

    if (Object.keys(fieldErrors).length > 0) {
        return res.status(400).json({
            error: "فارم کی معلومات درست کریں۔",
            fields: fieldErrors
        });
    }

    const recipient =
        process.env.CONTACT_EMAIL ||
        process.env.SMTP_USER ||
        "";
    const smtpHost = process.env.SMTP_HOST || "";
    const smtpUser = process.env.SMTP_USER || "";
    const smtpPassword = process.env.SMTP_PASS || "";

    if (!smtpHost || !smtpUser || !smtpPassword || !recipient) {
        console.error("Contact form SMTP configuration is incomplete.");

        return res.status(503).json({
            error: "رابطہ سروس اس وقت دستیاب نہیں ہے۔ براہ کرم بعد میں دوبارہ کوشش کریں۔"
        });
    }

    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPassword
        }
    });

    try {
        await transporter.sendMail({
            from: process.env.CONTACT_FROM_EMAIL || smtpUser,
            to: recipient,
            replyTo: email,
            subject: `Contact form: ${subject}`,
            text: [
                `Name: ${name}`,
                `Email: ${email}`,
                `Subject: ${subject}`,
                "",
                message
            ].join("\n")
        });

        return res.status(200).json({
            success: true,
            message: "آپ کا پیغام کامیابی سے بھیج دیا گیا ہے۔"
        });
    } catch (error) {
        console.error("Contact form email error:", {
            code: error.code || "unknown",
            responseCode: error.responseCode || null,
            message: error.message || "Email delivery failed."
        });

        return res.status(502).json({
            error: "پیغام بھیجا نہیں جا سکا۔ براہ کرم دوبارہ کوشش کریں۔"
        });
    }
};
