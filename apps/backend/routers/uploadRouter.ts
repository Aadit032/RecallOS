import express from "express"
import { s3 } from "@repo/minio/client"

const uploadRouter = express();

uploadRouter.post("/pdf", (req, res) => {

});

export default uploadRouter;