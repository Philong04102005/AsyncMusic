CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "googleSub" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "avatar" TEXT,
  "preferences" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
