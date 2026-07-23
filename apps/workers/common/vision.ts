import { openrouterClient } from "@repo/openrouter/client";

const VISION_MODEL = process.env.VISION_MODEL as string;

export type VisionResult = {
    caption: string;
    ocr: string;
    /** Combined text suitable for embedding. */
    text: string;
};

/**
 * Run a vision model on an image (data URL or https URL).
 * Returns a caption + OCR text; falls back to free-form description if JSON parse fails.
 */
export async function describeImage(imageUrl: string): Promise<VisionResult> {
    if (!VISION_MODEL) throw new Error("VISION_MODEL is not set");

    const prompt = `Analyze this image for a retrieval/search system.

        Respond with ONLY valid JSON (no markdown fences) matching:
        {
            "caption": "A clear 1-3 sentence description of the image content, layout, and purpose",
            "ocr": "All readable text in the image, preserving structure with newlines when helpful. Empty string if none."
        }

        Be accurate. Do not invent text that is not visible.`;

    const response = await openrouterClient.chat.send({
        chatRequest: {
            model: VISION_MODEL,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            imageUrl: { url: imageUrl, detail: "high" },
                        },
                    ],
                },
            ],
        },
    });

    const raw = (response?.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) throw new Error("Vision model returned empty content");

    return parseVisionResponse(raw);
}

function parseVisionResponse(raw: string): VisionResult {
    // Strip optional ```json fences
    let body = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) body = fence[1].trim();

    try {
        const parsed = JSON.parse(body) as { caption?: unknown; ocr?: unknown };
        const caption = typeof parsed.caption === "string" ? parsed.caption.trim() : "";
        const ocr = typeof parsed.ocr === "string" ? parsed.ocr.trim() : "";
        const text = composeVisionText(caption, ocr);
        if (!text) throw new Error("empty vision fields");
        return { caption, ocr, text };
    } catch {
        // Free-form fallback
        const text = raw.trim();
        return { caption: text, ocr: "", text };
    }
}

export function composeVisionText(caption: string, ocr: string): string {
    const parts: string[] = [];
    if (caption) parts.push(caption);
    if (ocr) parts.push(`OCR text:\n${ocr}`);
    return parts.join("\n\n").trim();
}
