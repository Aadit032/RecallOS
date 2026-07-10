import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express"

declare global {
   namespace Express {
      interface Request {
         userId?: string
      }
   }
}

const JWT_SECRET = process.env.JWT_SECRET as string;

export default async function middleware(req: Request, res: Response, next: NextFunction){
   const authHeaders = req.headers["authorization"];

   const token = authHeaders?.split("Bearer ")[1];
   console.log("token at middleware: " + token);

   if(!token){
      res.status(404).json({ message: "Missing token in request" });
      return;
   }

   try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;
      req.userId = decoded.id;
      next();
   } catch (e) {
      res.status(401).json({ error: "Unauthorized" });
      console.log("Error verifying token: ", e);
      return
   }
    
}