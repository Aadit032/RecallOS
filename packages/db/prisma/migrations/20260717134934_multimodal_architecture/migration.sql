-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "DocumentStatus" ADD VALUE 'PARSING';
ALTER TYPE "DocumentStatus" ADD VALUE 'PARSED';
ALTER TYPE "DocumentStatus" ADD VALUE 'EMBEDDING';
ALTER TYPE "DocumentStatus" ADD VALUE 'INDEXED';
ALTER TYPE "DocumentStatus" ADD VALUE 'READY';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
ADD COLUMN     "modality" TEXT NOT NULL DEFAULT 'pdf',
ALTER COLUMN "status" SET DEFAULT 'UPLOADED';

-- CreateTable
CREATE TABLE "ParsedChunkSet" (
    "id" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "ParsedChunkSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedChunk" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" JSONB,
    "chunkSetId" TEXT NOT NULL,

    CONSTRAINT "ParsedChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParsedChunkSet_documentId_idx" ON "ParsedChunkSet"("documentId");

-- CreateIndex
CREATE INDEX "ParsedChunk_chunkSetId_idx" ON "ParsedChunk"("chunkSetId");

-- AddForeignKey
ALTER TABLE "ParsedChunkSet" ADD CONSTRAINT "ParsedChunkSet_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedChunk" ADD CONSTRAINT "ParsedChunk_chunkSetId_fkey" FOREIGN KEY ("chunkSetId") REFERENCES "ParsedChunkSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
