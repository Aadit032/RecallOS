import { xAutoClaimOnStream, xPendingRangeOnStream, xAckOnStream, xAddToStream } from "@repo/redis-stream/client";
import { prismaClient } from "@repo/prisma/client";

export type MessagePayload = Record<string, string>;

export interface StaleClaimConfig {
    stream: string;
    group: string;
    workerId: string;
    dlqStream: string;
    idleThresholdMs: number;
    maxRetries: number;
    processFn: (payload: MessagePayload) => Promise<void>;
    onMaxRetries?: (payload: MessagePayload) => Promise<void>;
}

async function defaultOnMaxRetries(payload: MessagePayload, dlqStream: string): Promise<void> {
    const docId = payload.docId;
    if (docId) {
        await prismaClient.document.update({
            where: { id: docId },
            data: { status: "FAILED" },
        });
        await xAddToStream(dlqStream, { docId });
    }
}

export async function claimStaleJobs(config: StaleClaimConfig): Promise<void> {
    const { stream, group, workerId, dlqStream, idleThresholdMs, maxRetries, processFn } = config;
    const onMaxRetries = config.onMaxRetries ?? ((p: MessagePayload) => defaultOnMaxRetries(p, dlqStream));

    const claimed = await xAutoClaimOnStream(stream, group, workerId, idleThresholdMs, 10);

    for (const msg of claimed) {
        const payload = msg.message;

        const pendingInfo = await xPendingRangeOnStream(stream, group, msg.id, msg.id, 1);
        const deliveryCount = pendingInfo?.[0]?.deliveryCount ?? 1;

        if (deliveryCount > maxRetries) {
            console.log(`[claimStaleJobs] deliveryCount ${deliveryCount} > ${maxRetries} on "${stream}" — moving to DLQ`);
            try {
                await onMaxRetries(payload);
            } catch (e) {
                console.log(`[claimStaleJobs] onMaxRetries failed:`, e);
            }
            await xAckOnStream(stream, group, msg.id);
        } else {
            try {
                await prismaClient.document.update({
                    where: { id: payload.docId },
                    data: { status: "RETRYING" },
                });
            } catch (e) {
                console.log(`[claimStaleJobs] Failed to mark docId="${payload.docId}" as RETRYING:`, e);
            }
            try {
                await processFn(payload);
                await xAckOnStream(stream, group, msg.id);
            } catch (e) {
                console.log(`[claimStaleJobs] Error processing claimed message on "${stream}":`, e);
            }
        }
    }
}

export async function startClaimLoop(config: StaleClaimConfig, intervalMs: number): Promise<void> {
    while (true) {
        await claimStaleJobs(config);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}
