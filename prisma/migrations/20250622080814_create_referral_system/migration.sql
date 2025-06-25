-- CreateTable
CREATE TABLE "user_referrals" (
    "id" TEXT NOT NULL,
    "affiliateUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_referrals_affiliateUserId_userId_key" ON "user_referrals"("affiliateUserId", "userId");

-- AddForeignKey
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_affiliateUserId_fkey" FOREIGN KEY ("affiliateUserId") REFERENCES "AffiliateUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
