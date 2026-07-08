export interface Chunk {
    id: number;
    text: string;
}

export default function chunkMarkdown(
    markdown: string,
    maxChars = 2500,
    overlapChars = 250
): Chunk[] {
    const chunks: Chunk[] = [];

    // Split into sections by markdown headings
    const sections = markdown
        .split(/(?=^#{1,6}\s)/gm)
        .filter(Boolean);

    let id = 0;

    for (const section of sections) {
        if (section.length <= maxChars) {
            chunks.push({ id: id++, text: section.trim() });
            continue;
        }

        // Split large sections into paragraphs
        const paragraphs = section.split(/\n\s*\n/);

        let current = "";

        for (const paragraph of paragraphs) {
            if ((current + "\n\n" + paragraph).length <= maxChars) {
                current += (current ? "\n\n" : "") + paragraph;
                continue;
            }

            if (current) {
                chunks.push({ id: id++, text: current.trim() });

                const overlap =
                    current.slice(-overlapChars);

                current = overlap + "\n\n" + paragraph;
            } else {
                // Paragraph itself is huge -> split by sentences
                const sentences = paragraph.match(/[^.!?]+[.!?]+|\S+/g) ?? [];

                let sentenceChunk = "";

                for (const sentence of sentences) {
                    if ((sentenceChunk + " " + sentence).length <= maxChars) {
                        sentenceChunk += " " + sentence;
                    } else {
                        chunks.push({
                            id: id++,
                            text: sentenceChunk.trim(),
                        });

                        const overlap = sentenceChunk.slice(-overlapChars);

                        sentenceChunk = overlap + " " + sentence;
                    }
                }

                if (sentenceChunk.trim()) current = sentenceChunk.trim();
            }
        }

        if (current.trim()) {
            chunks.push({
                id: id++,
                text: current.trim(),
            });
        }
    }

    return chunks;
}