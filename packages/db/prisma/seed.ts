import { PrismaClient, VehicleCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  const rules: Array<{
    category: VehicleCategory;
    baseFare: number;
    baseKm: number;
    perKm: number;
    perMin: number;
    minFare: number;
  }> = [
    { category: 'HATCHBACK', baseFare: 80_000, baseKm: 10, perKm: 1_400, perMin: 200, minFare: 80_000 },
    { category: 'SEDAN', baseFare: 100_000, baseKm: 10, perKm: 1_700, perMin: 250, minFare: 100_000 },
    { category: 'SUV', baseFare: 140_000, baseKm: 10, perKm: 2_200, perMin: 300, minFare: 140_000 },
    { category: 'LUXURY', baseFare: 250_000, baseKm: 10, perKm: 3_500, perMin: 400, minFare: 250_000 },
  ];

  // Idempotent seed: clear existing rules then recreate (safe for dev only).
  await prisma.fareRule.deleteMany({});
  for (const r of rules) {
    await prisma.fareRule.create({
      data: { ...r, nightSurcharge: 0.1, tokenPercent: 0.2, effectiveFrom: now },
    });
  }

  console.log('Seeded', rules.length, 'fare rules');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
