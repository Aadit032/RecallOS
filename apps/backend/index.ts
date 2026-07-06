// import express from 'express';
import cors from "cors";
import uploadRouter from "./routers/uploadRouter.ts"
import Router from "express"
import dotenv from "dotenv"
dotenv.config()

const PORT = process.env.PORT

const router = Router();
router.use(cors());

router.use("/api/v1/upload", uploadRouter)


router.listen(PORT, () => {
    `Server is listening on ${PORT}`
});