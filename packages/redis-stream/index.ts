import { createClient } from "redis";
import dotenv from "dotenv"
dotenv.config();

const STREAM_NAME = process.env.STREAM_NAME as string;
const GROUP_NAME = process.env.GROUP_NAME as string;

export const redisClient = await createClient()
    .on('error', err => console.log('Redis Client Error', err))
    .connect();

try {
    await redisClient.xGroupCreate(
        STREAM_NAME,
        GROUP_NAME,
        "0",
        { MKSTREAM: true }
    );
} catch (err: any) {
    if (!err.message.includes("BUSYGROUP")) {
        throw err;
    }
}

export async function xAddFiles(documentId: string): Promise<string>{
    const res = await redisClient.xAdd(STREAM_NAME, '*', { documentId });
    return res;
}

type ResponseType = { documentId: string };

export async function xReadGroup(consumerGroup: string, workerId: string): Promise<ResponseType | undefined> {
    const res = await redisClient.xReadGroup(
      consumerGroup, workerId, {
      key: STREAM_NAME,
      id: ">"
   }, {
      'COUNT': 1,
      'BLOCK': 0
   }
   )

    if (!res){
        console.log("No response from the xReadGroup command");
        return undefined;
    }

   let documents: ResponseType = res[0]!.messages[0];
   return documents;
}

async function xAck(consumerGroup: string, eventId: string) {
   const res = await redisClient.xAck(STREAM_NAME, consumerGroup, eventId);
   return res;
}