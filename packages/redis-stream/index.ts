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

export async function xAdd(documentId: string): Promise<string | null>{
    console.log(`[redis-stream:xAdd] Adding documentId="${documentId}" to stream "${STREAM_NAME}"`);
    try{
        const res = await redisClient.xAdd(STREAM_NAME, '*', { documentId });
        console.log(`[redis-stream:xAdd] Success: messageId="${res}"`);
        return res;
    }catch(e){
        console.error(`[redis-stream:xAdd] Failed:`, e);
        return null;
    }
}

type streamMessage = { 
    id: string,
    message: {
        documentId: string 
    }
};

export async function xReadGroup(consumerGroup: string, workerId: string): Promise<streamMessage | undefined> {
    console.log(`[redis-stream:xReadGroup] Reading — group="${consumerGroup}", worker="${workerId}"`);
    try{
        const res = await redisClient.xReadGroup(
            consumerGroup, workerId, [{
                key: STREAM_NAME,
                id: ">"
            }], {
            'COUNT': 1,
            'BLOCK': 5000
        })

        if (!res){
            console.log(`[redis-stream:xReadGroup] No new messages (timeout)`);
            return undefined;
        }

        let documents: streamMessage = res[0]!.messages[0];
        console.log(`[redis-stream:xReadGroup] Received message: id="${documents.id}", documentId="${documents.message.documentId}"`);
        return documents;
    }catch(e){
        console.error(`[redis-stream:xReadGroup] Failed:`, e);
    }
}

export async function xAck(consumerGroup: string, eventId: string):Promise<number | null> {
    console.log(`[redis-stream:xAck] Acknowledging — group="${consumerGroup}", eventId="${eventId}"`);
    try{
        const res = await redisClient.xAck(STREAM_NAME, consumerGroup, eventId);
        console.log(`[redis-stream:xAck] Acknowledged (count=${res})`);
        return res;
    }catch(e){
        console.error(`[redis-stream:xAck] Failed:`, e);
        return null;
    }
}

/**
 * Claim messages that have been idle for at least minIdleTime milliseconds.
 * Returns claimed messages in the same shape as xReadGroup.
 */
export async function xAutoClaim(
    consumerGroup: string,
    consumerId: string,
    minIdleTime: number,
    count?: number
): Promise<streamMessage[]> {
    console.log(`[redis-stream:xAutoClaim] Claiming — group="${consumerGroup}", consumer="${consumerId}", minIdleTime=${minIdleTime}, count=${count ?? "all"}`);
    try {
        const result = await redisClient.xAutoClaim(
            STREAM_NAME,
            consumerGroup,
            consumerId,
            minIdleTime,
            "0",
            count ? { COUNT: count } : undefined
        );
        console.log(`[redis-stream:xAutoClaim] Claimed ${result.messages.length} message(s), next="${result.nextId}", deleted=${result.deletedMessages.length}`);
        return result.messages
            .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
            .map(msg => ({
                id: msg.id,
                message: { documentId: msg.message.documentId ?? "" },
            }));
    } catch (e) {
        console.error(`[redis-stream:xAutoClaim] Failed:`, e);
        return [];
    }
}

/**
 * Get per-message pending details (delivery count, idle time, consumer).
 * Only retrieves messages matching the given IDs when `ids` is provided.
 */
export async function xPendingRange(
    consumerGroup: string,
    start: string,
    end: string,
    count: number
): Promise<Array<{ id: string; consumer: string; deliveryCount: number }>> {
    console.log(`[redis-stream:xPendingRange] Pending detail — group="${consumerGroup}", start="${start}", end="${end}", count=${count}`);
    try {
        const result = await redisClient.xPendingRange(STREAM_NAME, consumerGroup, start, end, count)   ;
         console.log(`[redis-stream:xPendingRange] Got ${result.length} pending item(s)`);
        return result.map(item => ({
            id: item.id,
            consumer: item.consumer,
            deliveryCount: item.deliveriesCounter,
        }));
    } catch (e) {
        console.error(`[redis-stream:xPendingRange] Failed:`, e);
        return [];
    }
}

/**
 * Delete a stream entry by message id.
 */
export async function xDel(messageId: string): Promise<number | null> {
    console.log(`[redis-stream:xDel] Deleting messageId="${messageId}" from stream "${STREAM_NAME}"`);
    try {
        const res = await redisClient.xDel(STREAM_NAME, messageId);
        console.log(`[redis-stream:xDel] Deleted count=${res}`);
        return res;
    } catch (e) {
        console.error(`[redis-stream:xDel] Failed:`, e);
        return null;
    }
}

/**
 * Ack + delete a stream message so it cannot be processed or reclaimed.
 */
export async function removeStreamMessage(
    consumerGroup: string,
    messageId: string
): Promise<void> {
    console.log(`[redis-stream:removeStreamMessage] Removing messageId="${messageId}" group="${consumerGroup}"`);
    try {
        await xAck(consumerGroup, messageId);
    } catch (e) {
        console.warn(`[redis-stream:removeStreamMessage] Ack failed (may not be pending):`, e);
    }
    await xDel(messageId);
}

/**
 * Remove all stream entries for a document (by known message id and/or scan).
 * Use when deleting a document that may still be queued or in-flight.
 */
export async function removeDocumentFromStream(
    documentId: string,
    streamMessageId?: string | null
): Promise<number> {
    const group = GROUP_NAME;
    console.log(
        `[redis-stream:removeDocumentFromStream] documentId="${documentId}", streamMessageId="${streamMessageId ?? "none"}"`
    );
    let removed = 0;
    const seen = new Set<string>();

    const removeOne = async (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        await removeStreamMessage(group, id);
        removed += 1;
    };

    if (streamMessageId) {
        await removeOne(streamMessageId);
    }

    // Fallback / full scan: find any remaining entries with this documentId
    try {
        let start = "-";
        const COUNT = 100;
        // redis node client: xRange(key, start, end, { COUNT })
        // Iterate until no more messages
        for (let i = 0; i < 50; i++) {
            const messages = await redisClient.xRange(STREAM_NAME, start, "+", {
                COUNT,
            });
            if (!messages.length) break;

            for (const msg of messages) {
                const msgDocId = msg.message?.documentId;
                if (msgDocId === documentId) {
                    await removeOne(msg.id);
                }
            }

            const lastId = messages[messages.length - 1]!.id;
            // Advance past last id: use exclusive-ish next by reusing last and skipping seen
            if (messages.length < COUNT) break;
            // Redis XRANGE is inclusive; bump by reading after lastId via "(" prefix if supported
            start = `(${lastId}`;
        }
    } catch (e) {
        console.error(`[redis-stream:removeDocumentFromStream] Scan failed:`, e);
    }

    console.log(`[redis-stream:removeDocumentFromStream] Removed ${removed} message(s) for documentId="${documentId}"`);
    return removed;
}