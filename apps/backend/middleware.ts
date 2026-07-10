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
   const method = req.method;
   const path = req.path;
   console.log(`[middleware] Entry — ${method} ${path}`);

   const token = authHeaders?.split("Bearer ")[1];
   console.log(`[middleware] Token present: ${token ? "yes" : "no"}`);

   if(!token){
      console.warn(`[middleware] Missing token — ${method} ${path}`);
      res.status(404).json({ message: "Missing token in request" });
      return;
   }

   try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;
      req.userId = decoded.id;
      console.log(`[middleware] Authenticated: userId=${req.userId} — ${method} ${path}`);
      next();
   } catch (e) {
      console.error(`[middleware] Token verification failed — ${method} ${path}:`, e);
      res.status(401).json({ error: "Unauthorized" });
      return
   }
    
}