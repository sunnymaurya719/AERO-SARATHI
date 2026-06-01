import { PrismaClient, VehicleCategory, DocType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Phase 4 dev seed: drivers + vehicles across all categories, a few online and
 * fully-documented, plus a CONFIRMED booking ready for the assignment pipeline.
 * Idempotent: upserts by stable natural keys (regNo / phone / booking code).
 */
async function main() {
  const now = new Date();
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const categories: VehicleCategory[] = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'];
  const criticalDocs: DocType[] = ['LICENSE', 'RC', 'INSURANCE', 'PERMIT'];

  // 8 drivers: indices 0-3 ONLINE + ACTIVE + fully documented, 4-7 OFFLINE.
  for (let i = 0; i < 8; i++) {
    const category = categories[i % categories.length]!;
    const online = i < 4;
    const regNo = `PB10AS${String(1000 + i)}`;
    const phone = `+9170000000${String(i).padStart(2, '0')}`;

    const vehicle = await prisma.vehicle.upsert({
      where: { regNo },
      update: { category, status: 'ACTIVE' },
      create: {
        regNo,
        category,
        model: `${category} Model ${i + 1}`,
        capacity: category === 'SUV' || category === 'LUXURY' ? 6 : 4,
        status: 'ACTIVE',
      },
    });

    const existing = await prisma.driver.findUnique({ where: { phone } });
    const driver = existing
      ? await prisma.driver.update({
          where: { phone },
          data: {
            vehicleId: vehicle.id,
            status: 'ACTIVE',
            availability: online ? 'ONLINE' : 'OFFLINE',
            lastSeenAt: online ? now : null,
            rating: 4.2 + (i % 5) * 0.15,
          },
        })
      : await prisma.driver.create({
          data: {
            name: `Driver ${i + 1}`,
            phone,
            licenseNo: `DL-PB-${10000 + i}`,
            homeCity: ['Chandigarh', 'Mohali', 'Amritsar', 'Ludhiana'][i % 4]!,
            status: 'ACTIVE',
            availability: online ? 'ONLINE' : 'OFFLINE',
            lastSeenAt: online ? now : null,
            rating: 4.2 + (i % 5) * 0.15,
            vehicleId: vehicle.id,
          },
        });

    // Fully verify critical docs for online drivers so they pass eligibility.
    for (const type of criticalDocs) {
      const doc = await prisma.driverDocument.findFirst({
        where: { driverId: driver.id, type, deletedAt: null },
      });
      const data = {
        type,
        fileKey: `seed/${driver.id}/${type}.pdf`,
        fileName: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        verified: online,
        verifiedAt: online ? now : null,
        expiresAt: farFuture,
      };
      if (doc) {
        await prisma.driverDocument.update({ where: { id: doc.id }, data });
      } else {
        await prisma.driverDocument.create({ data: { driverId: driver.id, ...data } });
      }
    }

    await prisma.driverOfferStats.upsert({
      where: { driverId: driver.id },
      update: {},
      create: { driverId: driver.id },
    });
  }

  // A test CONFIRMED booking in Chandigarh, scheduled ~2h out.
  const passengerPhone = '+919812345678';
  const user = await prisma.user.upsert({
    where: { phone: passengerPhone },
    update: {},
    create: { phone: passengerPhone, name: 'Test Passenger' },
  });

  const code = 'AS-PH4-0001';
  const scheduledAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const existingBooking = await prisma.booking.findUnique({ where: { code } });
  if (!existingBooking) {
    await prisma.booking.create({
      data: {
        code,
        userId: user.id,
        quoteId: 'seed-quote-ph4',
        vehicleCategory: 'SEDAN',
        passengerName: 'Test Passenger',
        passengerPhone,
        pickupAddress: 'Sector 17, Chandigarh',
        pickupLat: 30.7415,
        pickupLng: 76.7681,
        dropAddress: 'Sector 35, Chandigarh',
        dropLat: 30.7257,
        dropLng: 76.7616,
        scheduledAt,
        estimatedKm: 6,
        estimatedMin: 18,
        fareTotal: 120_000,
        tokenAmount: 24_000,
        balanceAmount: 96_000,
        status: 'CONFIRMED',
        confirmedAt: now,
      },
    });
  }

  console.log('Phase 4 seed complete: 8 drivers (4 online), 8 vehicles, 1 CONFIRMED booking');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
