require("dotenv").config();

const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 3000;

function mountApiRoute(path, handler, middleware) {
    app.all(
        path,
        middleware || express.json({ limit: "2mb" }),
        (req, res, next) => {
            Promise.resolve(handler(req, res)).catch(next);
        }
    );
}

// Preserve the raw request body required for Lemon Squeezy signature checks.
mountApiRoute(
    "/api/webhook",
    require("./api/webhook"),
    express.raw({ type: "*/*", limit: "2mb" })
);

mountApiRoute("/api/chat", require("./api/chat"));
mountApiRoute(
    "/api/generate-article",
    require("./api/generate-article")
);
mountApiRoute(
    "/api/text-to-speech",
    require("./api/text-to-speech")
);
mountApiRoute("/api/contact", require("./api/contact"));
mountApiRoute("/api/site-visits", require("./api/site-visits"));
mountApiRoute("/api/create-checkout", require("./api/create-checkout"));
mountApiRoute("/api/admin-user-access", require("./api/admin-user-access"));
mountApiRoute("/api/send-email", require("./api/send-email"));

app.use(express.static(__dirname));

app.use((error, req, res, next) => {
    console.error("Local API error:", error);

    if (res.headersSent) {
        return next(error);
    }

    return res.status(error.statusCode || 500).json({
        error: "Internal server error."
    });
});

app.listen(port, () => {
    console.log(`Local server running at http://localhost:${port}`);
});
