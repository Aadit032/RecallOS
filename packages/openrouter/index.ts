import { OpenRouter } from "@openrouter/sdk";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is not set");
}

export const openrouterClient = new OpenRouter({});

// const result = await openrouterClient.chat.send({
//     chatRequest: {
//         model: "openai/gpt-5",
//         messages: [{role: "user",content: "Hello, how are you?"}],
//         provider: {
//         zdr: true,
//         sort: "price",
//         },
//         stream: true
//     }
// });

// for await (const chunk of result) {
//   process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
// }

// process.stdout.write("\n");
