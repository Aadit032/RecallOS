import { createClient } from "redis";
import dotenv from "dotenv"
dotenv.config();

const STREAM_NAME = process.env.STREAM_NAME as string;  

export const redisClient = await createClient()
    .on('error', err => console.log('Redis Client Error', err))
    .connect();

export async function xAddFiles(documentId: string): Promise<string>{
    const res = await redisClient.xAdd(STREAM_NAME, '*', { documentId });
    return res;
}

export async function xReadGroup(consumerGroup: string, workerId: string) {

}

// export async function xAck(){

// }