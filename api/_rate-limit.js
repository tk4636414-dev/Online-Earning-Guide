const buckets = new Map();
const MAX_BUCKETS = 10000;

function checkRateLimit(req, { action, limit, windowMs }) {
    const now = Date.now();
    const forwardedFor = req.headers?.["x-forwarded-for"];
    const forwardedClient = typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : "";
    const clientId = req.ip || forwardedClient || req.socket?.remoteAddress || "unknown";
    const key = `${action}:${clientId}`;
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.startedAt >= windowMs) {
        bucket = { startedAt: now, count: 0 };
        buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (buckets.size > MAX_BUCKETS) {
        for (const [bucketKey, value] of buckets) {
            if (now - value.startedAt >= windowMs) buckets.delete(bucketKey);
            if (buckets.size <= MAX_BUCKETS) break;
        }
        if (buckets.size > MAX_BUCKETS) {
            buckets.delete(buckets.keys().next().value);
        }
    }

    return {
        allowed: bucket.count <= limit,
        retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)
        )
    };
}

module.exports = { checkRateLimit };