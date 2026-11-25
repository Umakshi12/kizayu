-- CreateTable
CREATE TABLE "BuddyMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mood" TEXT,
    "source" TEXT,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuddyMessage_userId_createdAt_idx" ON "BuddyMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BuddyMessage" ADD CONSTRAINT "BuddyMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
