import cors from "cors";
import uploadRouter from "./routers/uploadRouter.ts"
import authRouter from "./routers/authRouter.ts"
import chatRouter from "./routers/chatRouter.ts";
import express from "express"
import dotenv from "dotenv"
import middleware from "./middleware.ts";
import downloadRouter from "./routers/downloadRouter.ts";
dotenv.config()

const PORT = process.env.PORT

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/upload", middleware, uploadRouter);
app.use("/api/v1/download", middleware, downloadRouter);
app.use("/api/v1/chat", middleware, chatRouter);

app.listen(PORT, () => {
  console.log(`Server is listening on ${PORT}`);
});