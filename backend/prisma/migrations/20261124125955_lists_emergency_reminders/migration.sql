-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "remindAt" TEXT;

-- CreateTable
CREATE TABLE "SharedList" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'cart',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "addedById" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyInfo" (
    "userId" TEXT NOT NULL,
    "bloodGroup" TEXT,
    "allergies" TEXT,
    "conditions" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyInfo_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "SharedList_circleId_idx" ON "SharedList"("circleId");

-- CreateIndex
CREATE INDEX "SharedListItem_listId_idx" ON "SharedListItem"("listId");

-- AddForeignKey
ALTER TABLE "SharedList" ADD CONSTRAINT "SharedList_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedListItem" ADD CONSTRAINT "SharedListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SharedList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyInfo" ADD CONSTRAINT "EmergencyInfo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
