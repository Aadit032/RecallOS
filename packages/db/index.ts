import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import dotenv from "dotenv"
dotenv.config();

console.log("DATABASE_URL: ", process.env.DATABASE_URL)

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prismaClient = new PrismaClient({ adapter });   