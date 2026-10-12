// ============================================================
// api/webhook.js
// Lemon Squeezy webhook handler for subscription activation/expiry
// ============================================================

const {
    requireFirestore,
    getPlanFromVariant,
    calculateSubscriptionExpiry,
    verifyLemonSignature,
    verifyFirebasePaymentUser,
    FieldValue
} = require("./_lib");


async function getRawBody(req) {

    if (Buffer.isBuffer(req.rawBody)) {
        return req.rawBody;
    }

    if (typeof req.rawBody === "string") {
        return Buffer.from(req.rawBody, "utf8");
    }

    if (Buffer.isBuffer(req.body)) {
        return req.body;
    }

    if (typeof req.body === "string") {
        return Buffer.from(req.body, "utf8");
    }

    if (
        !req ||
        typeof req.on !== "function"
    ) {
        return null;
    }

    return new Promise(
        (resolve, reject) => {

            const chunks = [];

            req.on(
                "data",
                chunk => chunks.push(
                    Buffer.isBuffer(chunk)
                        ? chunk
                        : Buffer.from(chunk)
                )
            );

            req.on(
                "end",
                () => resolve(
                    Buffer.concat(chunks)
                )
            );

            req.on(
                "error",
                reject
            );

        }
    );

}


function getPayloadValue(payload, key) {

    return payload?.data?.attributes?.[key] ??
        payload?.data?.[key] ??
        null;

}


function getCustomData(payload) {

    return payload?.meta?.custom_data ||
        payload?.meta?.custom ||
        payload?.data?.attributes?.checkout_data?.custom ||
        payload?.data?.attributes?.custom_data ||
        {};

}


module.exports = async function handler(req, res) {

    if (req.method !== "POST") {

        return res
            .status(405)
            .json({ error: "Method not allowed." });

    }

    let rawBody;

    try {

        rawBody =
            await getRawBody(req);

    } catch (error) {

        console.error("Webhook body read error:", error);

        return res
            .status(400)
            .json({ error: "Webhook body read failed." });

    }

    const signature =
        req.headers["x-signature"] ||
        req.headers["X-Signature"];

    if (!rawBody || !verifyLemonSignature(rawBody, signature)) {

        return res
            .status(401)
            .json({ error: "Invalid webhook signature." });

    }

    let payload;

    try {

        payload =
            JSON.parse(rawBody.toString("utf8"));

    } catch {

        return res
            .status(400)
            .json({ error: "Invalid JSON payload." });

    }

    const eventName =
        payload?.meta?.event_name ||
        "";

    const eventId =
        payload?.meta?.event_id ||
        null;

    if (!eventId) {

        return res
            .status(400)
            .json({ error: "Webhook event ID is required." });

    }

    const attributes =
        payload?.data?.attributes ||
        {};

    const customData =
        getCustomData(payload);

    const uid =
        customData.uid ||
        customData.user_id ||
        attributes.user_id ||
        null;

    const email =
        customData.email ||
        attributes.user_email ||
        attributes.email ||
        null;

    const paymentUser =
        await verifyFirebasePaymentUser({
            uid,
            email
        });

    if (!paymentUser) {

        return res
            .status(403)
            .json({
                error:
                    "Payment email اور Firebase user email match نہیں کرتے۔"
            });

    }

    const userUid =
        paymentUser.uid;

    const database =
        requireFirestore();

    const userRef =
        database.collection("users").doc(userUid);

    const eventRef =
        database.collection("webhookEvents").doc(
            String(eventId)
        );

    const cancellationEvent = [
        "subscription_cancelled",
        "subscription_expired",
        "subscription_paused"
    ].includes(eventName);

    if (cancellationEvent) {

        const result =
            await database.runTransaction(
                async transaction => {

                    const existing =
                        await transaction.get(eventRef);

                    if (existing.exists) {
                        return { duplicate: true };
                    }

                    transaction.create(
                        eventRef,
                        {
                            eventId: String(eventId),
                            eventName,
                            processedAt:
                                FieldValue.serverTimestamp()
                        }
                    );

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

                    return { duplicate: false };

                }
            );

        return res.status(200).json({
            received: true,
            status:
                result.duplicate
                    ? "duplicate_ignored"
                    : "subscription_disabled"
        });

    }

    const activationEvent = [
        "order_created",
        "subscription_created",
        "subscription_updated",
        "subscription_resumed"
    ].includes(eventName);

    if (!activationEvent) {

        return res.status(200).json({
            received: true,
            status: "ignored_event"
        });

    }

    const variantId =
        getPayloadValue(payload, "variant_id") ||
        payload?.data?.relationships?.variant?.data?.id;

    const plan =
        getPlanFromVariant(variantId);

    if (!plan) {

        return res
            .status(422)
            .json({ error: "Unsupported subscription plan." });

    }

    const providerExpiry =
        attributes.ends_at ||
        attributes.renews_at ||
        null;

    const expiresAt =
        providerExpiry &&
        !Number.isNaN(
            new Date(providerExpiry).getTime()
        )
            ? require("firebase-admin/firestore")
                .Timestamp.fromDate(
                    new Date(providerExpiry)
                )
            : calculateSubscriptionExpiry(
                plan.days,
                attributes.created_at
                    ? new Date(attributes.created_at)
                    : new Date()
            );

    const result =
        await database.runTransaction(
            async transaction => {

                const existing =
                    await transaction.get(eventRef);

                if (existing.exists) {
                    return { duplicate: true };
                }

                transaction.create(
                    eventRef,
                    {
                        eventId: String(eventId),
                        eventName,
                        processedAt:
                            FieldValue.serverTimestamp()
                    }
                );

                transaction.set(
                    userRef,
                    {
                        uid: userUid,
                        email: paymentUser.email || email,
                        isPremium: true,
                        subscription: "active",
                        plan: plan.name,
                        subscriptionEndsAt: expiresAt,
                        lemonVariantId: String(variantId),
                        lemonOrderId:
                            payload?.data?.id || "",
                        updatedAt:
                            FieldValue.serverTimestamp()
                    },
                    { merge: true }
                );

                return { duplicate: false };

            }
        );

    return res.status(200).json({
        received: true,
        status:
            result.duplicate
                ? "duplicate_ignored"
                : "subscription_activated",
        plan: plan.name,
        expiresAt: expiresAt.toDate().toISOString()
    });

};


module.exports.config = {
    api: {
        bodyParser: false
    }
};
