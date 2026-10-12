// ============================================================
// api/text-to-speech.js
// Vercel Serverless API
// OpenAI Text-to-Speech Endpoint
// POST /api/text-to-speech
// ============================================================

const {
    OPENAI_API_KEY,
    OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE,
    hasOpenAIConfig,
    cleanText,
    requirePremiumUser
} = require("./_lib");

const MAX_TTS_CHUNK_LENGTH = 3800;
const MAX_TTS_TEXT_LENGTH = 40000;
const PCM_SAMPLE_RATE = 24000;

function splitTextIntoChunks(text) {
    const chunks = [];
    let remaining = text.trim();

    while (remaining.length > MAX_TTS_CHUNK_LENGTH) {
        const maxBoundary = MAX_TTS_CHUNK_LENGTH;
        const spaceBoundary = remaining.lastIndexOf(" ", maxBoundary);
        const sentenceBoundary = Math.max(
            remaining.lastIndexOf("۔ ", maxBoundary),
            remaining.lastIndexOf(". ", maxBoundary),
            remaining.lastIndexOf("? ", maxBoundary),
            remaining.lastIndexOf("! ", maxBoundary)
        );
        let boundary = sentenceBoundary >= Math.floor(maxBoundary * 0.6)
            ? sentenceBoundary + 1
            : spaceBoundary;

        if (boundary <= 0) boundary = maxBoundary;
        if (
            boundary < remaining.length &&
            /[\uD800-\uDBFF]/.test(remaining[boundary - 1]) &&
            /[\uDC00-\uDFFF]/.test(remaining[boundary])
        ) {
            boundary -= 1;
        }

        chunks.push(remaining.slice(0, boundary).trim());
        remaining = remaining.slice(boundary).trimStart();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
}

function createWavBuffer(pcmBuffer) {
    const channels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
    header.writeUInt32LE(PCM_SAMPLE_RATE * channels * bytesPerSample, 28);
    header.writeUInt16LE(channels * bytesPerSample, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([header, pcmBuffer]);
}


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

    try {

        await requirePremiumUser(req);

    } catch (error) {

        return res
            .status(error.statusCode || 401)
            .json({
                error:
                    error.statusCode === 403
                        ? "آڈیو کے لیے active Premium subscription ضروری ہے۔"
                        : "آڈیو کے لیے login ضروری ہے۔"
            });

    }


    // --------------------------------------------------------
    // Check OpenAI configuration
    // --------------------------------------------------------

    if (!hasOpenAIConfig()) {

        return res
            .status(500)
            .json({
                error:
                    "OpenAI API key configured نہیں ہے۔"
            });

    }


    // --------------------------------------------------------
    // Get text
    // --------------------------------------------------------

    const text =
        cleanText(
            req.body?.text
        );


    // --------------------------------------------------------
    // Validate text
    // --------------------------------------------------------

    if (!text) {

        return res
            .status(400)
            .json({
                error: "Text is required."
            });

    }

    if (text.length > MAX_TTS_TEXT_LENGTH) {
        return res.status(413).json({
            error: "Article audio is limited to 40,000 characters per request."
        });
    }

    const textChunks = splitTextIntoChunks(text);

    // --------------------------------------------------------
    // OpenAI TTS
    // --------------------------------------------------------

    try {

        const pcmChunks = new Array(textChunks.length);
        let nextChunkIndex = 0;
        let chunkFailure = null;

        const synthesizeNextChunk = async () => {
            while (!chunkFailure) {
                const index = nextChunkIndex;
                nextChunkIndex += 1;
                if (index >= textChunks.length) return;

                try {
                    const response = await fetch(
                        "https://api.openai.com/v1/audio/speech",
                        {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${OPENAI_API_KEY}`,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                model: OPENAI_TTS_MODEL,
                                input: textChunks[index],
                                voice: OPENAI_TTS_VOICE,
                                response_format: "pcm",
                                speed: 1.0
                            })
                        }
                    );

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => null);
                        chunkFailure = {
                            chunk: index + 1,
                            status: response.status,
                            code: errorData?.error?.code || "unknown"
                        };
                        return;
                    }

                    pcmChunks[index] = Buffer.from(await response.arrayBuffer());
                } catch (error) {
                    chunkFailure = {
                        chunk: index + 1,
                        status: null,
                        code: error.code || error.name || "request_failed"
                    };
                    return;
                }
            }
        };

        const workerCount = Math.min(3, textChunks.length);
        await Promise.all(
            Array.from({ length: workerCount }, () => synthesizeNextChunk())
        );

        if (chunkFailure) {
            console.error("OpenAI TTS chunk failed:", {
                ...chunkFailure,
                totalChunks: textChunks.length
            });
            return res.status(502).json({
                error: "Audio generation failed. Please try again."
            });
        }

        const pcmBuffer = Buffer.concat(pcmChunks);
        if (!pcmBuffer.length) {
            return res.status(502).json({ error: "Audio generation returned no audio." });
        }

        const audioBuffer = createWavBuffer(pcmBuffer);
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audioBuffer.length);
        res.setHeader("Cache-Control", "no-store");
        return res.send(audioBuffer);


    } catch (error) {

        console.error("TTS server error:", {
            code: error.code || "unknown",
            message: error.message || "Audio generation failed."
        });


        return res
            .status(500)
            .json({

                error: "Audio generation failed. Please try again."

            });

    }

};