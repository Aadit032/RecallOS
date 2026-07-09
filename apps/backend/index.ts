import cors from "cors";
import uploadRouter from "./routers/uploadRouter.ts"
import authRouter from "./routers/authRouter.ts"
// import middleware from "./middleware.ts";
import express from "express"
import dotenv from "dotenv"
dotenv.config()

const PORT = process.env.PORT

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/upload", uploadRouter);

app.listen(PORT, () => {
  console.log(`Server is listening on ${PORT}`);
});