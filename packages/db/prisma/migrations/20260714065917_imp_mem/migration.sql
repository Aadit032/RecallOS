/*
  Warnings:

  - You are about to drop the column `facts` on the `Memory` table. All the data in the column will be lost.
  - Added the required column `fact` to the `Memory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Memory" DROP COLUMN "facts",
ADD COLUMN     "fact" TEXT NOT NULL,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Memory_userId_idx" ON "Memory"("userId");
