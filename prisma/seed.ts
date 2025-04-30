import { PrismaClient, SubscriptionPlanType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create basic pricing plans
  const plans = [
    {
      name: 'Trial Plan',
      planType: SubscriptionPlanType.TRIAL,
      basePrice: 0, // Free
      evaluationPrice: 0, // Free
      active: true,
    },
    {
      name: 'Basic Plan',
      planType: SubscriptionPlanType.BASIC,
      basePrice: 20, // $20/project
      evaluationPrice: 0.5, // 50 cents per evaluation
      active: true,
    },
    {
      name: 'Standard Plan',
      planType: SubscriptionPlanType.STANDARD,
      basePrice: 30, // $30/project
      evaluationPrice: 0.25, // 25 cents per evaluation
      active: true,
    },
    {
      name: 'Premium Plan',
      planType: SubscriptionPlanType.PREMIUM,
      basePrice: 50, // $50/project
      evaluationPrice: 0.1, // 10 cents per evaluation
      active: true,
    },
    {
      name: 'Custom Plan',
      planType: SubscriptionPlanType.CUSTOM,
      basePrice: 0, // Custom base price
      evaluationPrice: 0, // Custom evaluation price
      active: true,
    },
  ];

  for (const plan of plans) {
    const existingPlan = await prisma.pricingPlan.findFirst({
      where: { name: plan.name },
    });

    if (!existingPlan) {
      await prisma.pricingPlan.create({
        data: plan,
      });
      console.log(`Created pricing plan: ${plan.name}`);
    } else {
      console.log(`Pricing plan already exists: ${plan.name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
