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
    const decoded = signupSchema.safeParse(req.body);
    if(!decoded.success){
        res.status(422).json({ message: "Invalid input. Try again.", error: decoded.error })
        return;
    }

    const { username, password } = decoded.data;
    const hashedPassword = await hash(password, 5);

    try{
        await prismaClient.user.create({
            data: { username, password: hashedPassword }
        });

        res.status(200).json({
            message: "User created!!"
        })
    }catch(e){
        res.status(500).json({ message: "Singup db insert failure" })
    }
})

authRouter.post("/signin", async (req, res) => {
    const decoded = signinSchema.safeParse(req.body);
    if(!decoded.success){
        res.status(422).json({ message: "Invalid input. Try again.", error: decoded.error })
        return;
    }

    const { username, password } = decoded.data;

    try{
        const user = await prismaClient.user.findUnique({
            where: { username }
        });

        if(!user){
            res.status(400).json({ message: "No user found!!" });
            return;
        }

        if(await compare(password, user.password)){
            res.status(401).json({
                message: "User is not authorized."
            })
            return;
        }

        const token = jwt.sign({
            id: user.id
        }, JWT_SECRET);

        res.status(200).json({
            message: "User created!!",
            token
        });

    }catch(e){
        res.status(500).json({ message: "Signin failure" })
    }
    
})

export default authRouter;