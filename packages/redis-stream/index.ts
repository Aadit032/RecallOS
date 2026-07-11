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