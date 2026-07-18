import { createClient } from "redis";
import dotenv from "dotenv"
dotenv.config();

const STREAM_NAME = process.env.STREAM_NAME as string;
const GROUP_NAME = process.env.GROUP_NAME as string;

console.log(`[redis-stream] Connecting — stream="${STREAM_NAME}", group="${GROUP_NAME}"`);
export const redisClient = await createClient()
    .on('error', err => console.error('[redis-stream] Client Error:', err))
    .connect();

console.log(`[redis-stream] Connected, creating consumer group`);
try {
    await redisClient.xGroupCreate(
        STREAM_NAME,
        GROUP_NAME,
        "0",
        { MKSTREAM: true }
    );
    console.log(`[redis-stream] Consumer group "${GROUP_NAME}" created`);
} catch (err: any) {
    if (!err.message.includes("BUSYGROUP")) {
        console.error(`[redis-stream] Error creating group:`, err);
        throw err;
    }
    console.log(`[redis-stream] Consumer group "${GROUP_NAME}" already exists`);
}

//  Ensure a stream + consumer group exist (idempotent).
export async function ensureStream(stream: string, group: string): Promise<void> {
    try {
        await redisClient.xGroupCreate(stream, group, "0", { MKSTREAM: true });
        console.log(`[redis-stream] Stream "${stream}" / group "${group}" created`);
    } catch (err: any) {
        if (!err.message.includes("BUSYGROUP")) {
            console.error(`[redis-stream] Error creating stream "${stream}":`, err);
            throw err;
        }
    }
}

export async function xAddToStream(stream: string, fields: Record<string, string>): Promise<string | null> {
    try {
        const res = await redisClient.xAdd(stream, '*', fields);
        console.log(`[redis-stream:xAddToStream] Stream "${stream}" — id="${res}"`);
        return res;
    } catch (e) {
        console.error(`[redis-stream:xAddToStream] Failed:`, e);
        return null;
    }
}

export async function xAdd(userId: string, documentId: string): Promise<string | null>{
    return xAddToStream(STREAM_NAME, { userId, documentId });
}

type streamMessage = { 
    id: string,
    message: Record<string, string>
};

export async function xReadGroupFromStream(
    stream: string,
    consumerGroup: string,
    workerId: string,
    count = 1,
    block = 5000
): Promise<streamMessage | undefined> {
    try {
        const res = await redisClient.xReadGroup(
            consumerGroup, workerId, [{ key: stream, id: ">" }],
            { COUNT: count, BLOCK: block }
        );
        if (!res) return undefined;
        return res[0]!.messages[0] as streamMessage;
    } catch (e) {
        console.error(`[redis-stream:xReadGroupFromStream] Failed:`, e);
    }
}

export async function xReadGroup(consumerGroup: string, workerId: string): Promise<streamMessage | undefined> {
    return xReadGroupFromStream(STREAM_NAME, consumerGroup, workerId);
}

export async function xAckOnStream(stream: string, consumerGroup: string, eventId: string): Promise<number | null> {
    try {
        const res = await redisClient.xAck(stream, consumerGroup, eventId);
        return res;
    } catch (e) {
        console.error(`[redis-stream:xAckOnStream] Failed:`, e);
        return null;
    }
}

export async function xAck(consumerGroup: string, eventId: string): Promise<number | null> {
    return xAckOnStream(STREAM_NAME, consumerGroup, eventId);
}

export async function xAutoClaimOnStream(
    stream: string,
    consumerGroup: string,
    consumerId: string,
    minIdleTime: number,
    count?: number
): Promise<streamMessage[]> {
    try {
        const result = await redisClient.xAutoClaim(
            stream, consumerGroup, consumerId, minIdleTime, "0",
            count ? { COUNT: count } : undefined
        );
        return result.messages
            .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
            .map(msg => ({
                id: msg.id,
                message: Object.fromEntries(
                    Object.entries(msg.message).map(([k, v]) => [k, String(v)])
                ),
            }));
    } catch (e) {
        console.error(`[redis-stream:xAutoClaimOnStream] Failed:`, e);
        return [];
    }
}

export async function xAutoClaim(
    consumerGroup: string,
    consumerId: string,
    minIdleTime: number,
    count?: number
): Promise<streamMessage[]> {
    return xAutoClaimOnStream(STREAM_NAME, consumerGroup, consumerId, minIdleTime, count);
}

export async function xPendingRangeOnStream(
    stream: string,
    consumerGroup: string,
    start: string,
    end: string,
    count: number
): Promise<Array<{ id: string; consumer: string; deliveryCount: number }>> {
    try {
        const result = await redisClient.xPendingRange(stream, consumerGroup, start, end, count);
        return result.map(item => ({
            id: item.id,
            consumer: item.consumer,
            deliveryCount: item.deliveriesCounter,
        }));
    } catch (e) {
        console.error(`[redis-stream:xPendingRangeOnStream] Failed:`, e);
        return [];
    }
}

export async function xPendingRange(
    consumerGroup: string,
    start: string,
    end: string,
    count: number
): Promise<Array<{ id: string; consumer: string; deliveryCount: number }>> {
    return xPendingRangeOnStream(STREAM_NAME, consumerGroup, start, end, count);
}

export async function xDelOnStream(stream: string, messageId: string): Promise<number | null> {
    try {
        return await redisClient.xDel(stream, messageId);
    } catch (e) {
        console.error(`[redis-stream:xDelOnStream] Failed:`, e);
        return null;
    }
}

export async function xDel(messageId: string): Promise<number | null> {
    return xDelOnStream(STREAM_NAME, messageId);
}

export async function removeStreamMessage(
    consumerGroup: string,
    messageId: string
): Promise<void> {
    try {
        await xAck(consumerGroup, messageId);
    } catch (e) {
        console.warn(`[redis-stream:removeStreamMessage] Ack failed:`, e);
    }
    await xDel(messageId);
}

export async function removeStreamMessageOnStream(
    stream: string,
    consumerGroup: string,
    messageId: string
): Promise<void> {
    try {
        await xAckOnStream(stream, consumerGroup, messageId);
    } catch (e) {
        console.warn(`[redis-stream:removeStreamMessageOnStream] Ack failed:`, e);
    }
    await xDelOnStream(stream, messageId);
}

export async function removeDocumentFromStream(
    documentId: string,
    streamMessageId?: string | null
): Promise<number> {
    const group = GROUP_NAME;
    let removed = 0;
    const seen = new Set<string>();

    const removeOne = async (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        await removeStreamMessage(group, id);
        removed += 1;
    };

    if (streamMessageId) await removeOne(streamMessageId);

    try {
        let start = "-";
        const COUNT = 100;
        for (let i = 0; i < 50; i++) {
            const messages = await redisClient.xRange(STREAM_NAME, start, "+", { COUNT });
            if (!messages.length) break;
            for (const msg of messages) {
                const msgDocId = msg.message?.documentId;
                if (msgDocId === documentId) await removeOne(msg.id);
            }
            const lastId = messages[messages.length - 1]!.id;
            if (messages.length < COUNT) break;
            start = `(${lastId}`;
        }
    } catch (e) {
        console.error(`[redis-stream:removeDocumentFromStream] Scan failed:`, e);
    }

    return removed;
}

export async function removeDocumentFromAllStreams(
    documentId: string,
    streams: string[],
    groups: string[]
): Promise<number> {
    let total = 0;
    for (let i = 0; i < streams.length; i++) {
        const stream = streams[i]!;
        const group = groups[i]!;
        try {
            let start = "-";
            const COUNT = 100;
            for (let j = 0; j < 50; j++) {
                const messages = await redisClient.xRange(stream, start, "+", { COUNT });
                if (!messages.length) break;
                for (const msg of messages) {
                    if (msg.message?.documentId === documentId || msg.message?.docId === documentId) {
                        await removeStreamMessageOnStream(stream, group, msg.id);
                        total += 1;
                    }
                }
                const lastId = messages[messages.length - 1]!.id;
                if (messages.length < COUNT) break;
                start = `(${lastId}`;
            }
        } catch (e) {
            console.error(`[redis-stream] Remove from "${stream}" failed:`, e);
        }
    }
    return total;
}
