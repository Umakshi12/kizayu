-- AlterTable
ALTER TABLE "SafetySetting" ADD COLUMN     "sosRecording" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SosContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "locUpdatedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SosEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosClip" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "seconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SosContact_userId_phone_key" ON "SosContact"("userId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "SosEvent_token_key" ON "SosEvent"("token");

-- CreateIndex
CREATE INDEX "SosEvent_userId_idx" ON "SosEvent"("userId");

-- CreateIndex
CREATE INDEX "SosEvent_startedAt_idx" ON "SosEvent"("startedAt");

-- CreateIndex
CREATE INDEX "SosClip_eventId_idx" ON "SosClip"("eventId");

-- AddForeignKey
ALTER TABLE "SosContact" ADD CONSTRAINT "SosContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosClip" ADD CONSTRAINT "SosClip_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SosEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
