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

export async function xAdd(documentId: string): Promise<string | null>{
    try{
        const res = await redisClient.xAdd(STREAM_NAME, '*', { documentId });
        console.log("The document Id has been pushed on the stream!!!")
        return res;
    }catch(e){
        console.log("xAdd to stream failed." + e);
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
            console.log("No response from the xReadGroup command");
            return undefined;
        }

        let documents: streamMessage = res[0]!.messages[0];
        console.log("Read message from the stream | message: ", documents);
        return documents;
    }catch(e){
        console.log("xReadGroup command failed." + e);
    }
}

export async function xAck(consumerGroup: string, eventId: string):Promise<number | null> {
    try{
        const res = await redisClient.xAck(STREAM_NAME, consumerGroup, eventId);
        return res;
    }catch(e){
        console.log("xAck failed." + e);
        return null;
    }
}