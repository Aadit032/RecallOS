-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
