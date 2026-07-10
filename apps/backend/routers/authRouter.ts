import Router from "express"
import jwt from "jsonwebtoken"
import { prismaClient } from "@repo/prisma/client";
import { signupSchema, signinSchema } from "../types";
import { hash, compare } from "bcrypt"
import dotenv from "dotenv";
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET as string

const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
    console.log(`[auth:signup] Entry`);
    const decoded = signupSchema.safeParse(req.body);
    if(!decoded.success){
        console.warn(`[auth:signup] Invalid input:`, decoded.error);
        res.status(422).json({ message: "Invalid input. Try again.", error: decoded.error })
        return;
    }

    const { username, password } = decoded.data;
    console.log(`[auth:signup] Creating user: username="${username}"`);
    const hashedPassword = await hash(password, 5);

    try{
        await prismaClient.user.create({
            data: { username, password: hashedPassword }
        });

        console.log(`[auth:signup] User created: username="${username}"`);
        res.status(200).json({
            message: "User created!!"
        })
    }catch(e){
        console.error(`[auth:signup] DB insert failure:`, e);
        res.status(500).json({ message: "Signxup db insert failure", error: e instanceof Error? e.message : e })
    }
})

authRouter.post("/signin", async (req, res) => {
    console.log(`[auth:signin] Entry`);
    const decoded = signinSchema.safeParse(req.body);
    if(!decoded.success){
        console.warn(`[auth:signin] Invalid input:`, decoded.error);
        res.status(422).json({ message: "Invalid input. Try again.", error: decoded.error })
        return;
    }

    const { username, password } = decoded.data;
    console.log(`[auth:signin] Looking up user: username="${username}"`);

    try{
        const user = await prismaClient.user.findUnique({
            where: { username }
        });

        if(!user){
            console.warn(`[auth:signin] No user found: "${username}"`);
            res.status(400).json({ message: "No user found!!" });
            return;
        }

        console.log(`[auth:signin] User found, comparing password`);
        const valid = await compare(password, user.password)
        if(!valid){
            console.warn(`[auth:signin] Invalid password for user: "${username}"`);
            res.status(401).json({
                message: "User is not authorized."
            })
            return;
        }

        const token = jwt.sign({
            id: user.id
        }, JWT_SECRET);

        console.log(`[auth:signin] Signin successful: username="${username}", token generated`);
        res.status(200).json({
            message: "User created!!",
            token
        });

    }catch(e){
        console.error(`[auth:signin] Signin failure:`, e);
        res.status(500).json({ message: "Signin failure" })
    }
    
})

export default authRouter;