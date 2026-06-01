/**
 * Seed demo admin data for development.
 *
 *   pnpm --filter @aero/api tsx --env-file=.env scripts/seed-admin.ts
 *
 * Creates one admin per non-super role (ADMIN, OPS, FINANCE, SUPPORT) with a
 * deterministic password + TOTP secret, plus demo drivers, vehicles and
 * bookings. Refuses to run when NODE_ENV=production.
 */
import { prisma } from '../src/prisma.js';
import { hashPassword } from '../src/modules/admin/auth/password.js';
import type { VehicleCategory } from '@aero/db';

const DEMO_PASSWORD = 'AeroAdminDev123!';
// Deterministic base32 TOTP secrets (dev only — never use in production).
const DEMO_ADMINS: { email: string; name: string; role: 'ADMIN' | 'OPS' | 'FINANCE' | 'SUPPORT'; totpSecret: string }[] = [
  { email: 'admin@dev.local', name: 'Demo Admin', role: 'ADMIN', totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' },
  { email: 'ops@dev.local', name: 'Demo Ops', role: 'OPS', totpSecret: 'KRSXG5BAKVXXG5BAKRSXG5BAKVXXG5BA' },
  { email: 'finance@dev.local', name: 'Demo Finance', role: 'FINANCE', totpSecret: 'MFRGGZDFMZTWQ2LKMFRGGZDFMZTWQ2LK' },
  { email: 'support@dev.local', name: 'Demo Support', role: 'SUPPORT', totpSecret: 'NB2HI4DTHIXS653XNB2HI4DTHIXS653X' },
];

const CATEGORIES: VehicleCategory[] = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'];
const CITIES = ['Amritsar', 'Ludhiana', 'Jalandhar', 'Patiala', 'Mohali'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed admin demo data in production.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Admin users
  for (const a of DEMO_ADMINS) {
    await prisma.adminUser.upsert({
      where: { email: a.email },
      update: { role: a.role, totpSecret: a.totpSecret, totpEnabled: true, status: 'ACTIVE' },
      create: {
        email: a.email,
        name: a.name,
        role: a.role,
        passwordHash,
        totpSecret: a.totpSecret,
        totpEnabled: true,
        status: 'ACTIVE',
      },
    });
  }
  console.log(`Seeded ${DEMO_ADMINS.length} admin users (password: ${DEMO_PASSWORD})`);

  // Vehicles
  const vehicles = [];
  for (let i = 0; i < 15; i++) {
    const regNo = `PB${String(10 + i).padStart(2, '0')}AB${String(1000 + i)}`;
    const category = pick(CATEGORIES, i);
    const ownership = i % 3 === 0 ? 'COMPANY' : 'DRIVER';
    const vehicle = await prisma.vehicle.upsert({
      where: { regNo },
      update: {},
      create: {
        regNo,
        category,
        model: pick(['Swift', 'Dzire', 'Innova', 'Camry'], i),
        capacity: category === 'SUV' ? 7 : 4,
        ownership,
        status: 'ACTIVE',
        ...(ownership === 'COMPANY'
          ? {
              emiPlan: {
                create: {
                  principalAmount: 8_00_000_00,
                  monthlyEmi: 18_000_00,
                  tenureMonths: 48,
                  startDate: new Date('2024-01-01'),
                  lender: 'HDFC Bank',
                  loanRef: `LN-${1000 + i}`,
                },
              },
            }
          : {}),
      },
    });
    vehicles.push(vehicle);
  }
  console.log(`Seeded ${vehicles.length} vehicles`);

  // Drivers
  const drivers = [];
  for (let i = 0; i < 10; i++) {
    const phone = `+9198${String(76000000 + i)}`;
    const user = await prisma.user.upsert({
      where: { phone },
      update: { role: 'DRIVER' },
      create: { phone, name: `Driver ${i + 1}`, role: 'DRIVER' },
    });
    const driver = await prisma.driver.upsert({
      where: { phone },
      update: {},
      create: {
        userId: user.id,
        phone,
        name: `Driver ${i + 1}`,
        licenseNo: `PB-LIC-${10000 + i}`,
        homeCity: pick(CITIES, i),
        status: 'ACTIVE',
        vehicleId: vehicles[i]?.id ?? null,
        rating: 4 + (i % 10) / 10,
      },
    });
    drivers.push(driver);
  }
  console.log(`Seeded ${drivers.length} drivers`);

  // Demo customer + bookings
  const customer = await prisma.user.upsert({
    where: { phone: '+919800000000' },
    update: {},
    create: { phone: '+919800000000', name: 'Demo Customer', role: 'CUSTOMER' },
  });

  const statuses = ['PENDING', 'CONFIRMED', 'DRIVER_ASSIGNED', 'COMPLETED', 'CANCELLED'] as const;
  let created = 0;
  for (let i = 0; i < 50; i++) {
    const category = pick(CATEGORIES, i);
    const status = pick([...statuses], i);
    const scheduledAt = new Date(Date.now() + (i - 25) * 3600_000);
    const quote = await prisma.quote.create({
      data: {
        pickupAddress: `${pick(CITIES, i)} Railway Station`,
        pickupLat: 31.63 + i * 0.001,
        pickupLng: 74.87 + i * 0.001,
        dropAddress: `${pick(CITIES, i + 1)} Airport`,
        dropLat: 31.7 + i * 0.001,
        dropLng: 74.8 + i * 0.001,
        scheduledAt,
        distanceKm: 25 + (i % 30),
        durationMin: 40 + (i % 40),
        fares: {},
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const fareTotal = 1_00_000 + (i % 20) * 10_000;
    const tokenAmount = Math.round(fareTotal * 0.2);
    const assigned = status === 'DRIVER_ASSIGNED' || status === 'COMPLETED';
    await prisma.booking.create({
      data: {
        code: `AS${String(100000 + i)}`,
        userId: customer.id,
        quoteId: quote.id,
        vehicleCategory: category,
        passengerName: 'Demo Customer',
        passengerPhone: '+919800000000',
        pickupAddress: quote.pickupAddress,
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        dropAddress: quote.dropAddress,
        dropLat: quote.dropLat,
        dropLng: quote.dropLng,
        scheduledAt,
        estimatedKm: quote.distanceKm,
        estimatedMin: quote.durationMin,
        fareTotal,
        tokenAmount,
        balanceAmount: fareTotal - tokenAmount,
        status,
        confirmedAt: status === 'PENDING' ? null : new Date(),
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
        driverId: assigned ? drivers[i % drivers.length]?.id ?? null : null,
        vehicleId: assigned ? vehicles[i % vehicles.length]?.id ?? null : null,
      },
    });
    created++;
  }
  console.log(`Seeded ${created} bookings`);
  console.log('\nDone. Login at the admin app with any demo admin email above.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
