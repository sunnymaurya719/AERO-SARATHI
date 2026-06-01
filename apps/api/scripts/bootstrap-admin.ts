/**
 * Bootstrap the first SUPER_ADMIN account.
 *
 *   pnpm --filter @aero/api bootstrap:admin
 *
 * Prompts for an email + password (masked) and outputs an otpauth:// URI to
 * scan into an authenticator app. Refuses to run if any AdminUser already
 * exists (use the in-app user management for subsequent admins).
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { prisma } from '../src/prisma.js';
import { hashPassword } from '../src/modules/admin/auth/password.js';
import { generateTotpSecret, otpauthUri } from '../src/modules/admin/auth/totp.js';

function ask(question: string, mask = false): Promise<string> {
  let muted = false;
  const mutableOut = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: mutableOut, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (mask) process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = mask;
  });
}

async function main(): Promise<void> {
  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    console.error(`Refusing to bootstrap: ${existing} admin user(s) already exist.`);
    console.error('Use the in-app user management (Users page) to invite more admins.');
    process.exit(1);
  }

  const email = (await ask('Super admin email: ')).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Invalid email address.');
    process.exit(1);
  }
  const name = (await ask('Display name: ')) || email.split('@')[0];
  const password = await ask('Password (min 12 chars, hidden): ', true);
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }
  const confirm = await ask('Confirm password (hidden): ', true);
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const secret = generateTotpSecret();

  const user = await prisma.adminUser.create({
    data: {
      email,
      name,
      passwordHash,
      role: 'SUPER_ADMIN',
      totpSecret: secret,
      totpEnabled: false,
      status: 'ACTIVE',
    },
  });

  console.log('\n✅ Super admin created:', user.email);
  console.log('\nScan this into your authenticator app (Google Authenticator, Authy, 1Password):');
  console.log('\n  ' + otpauthUri(user.email, secret) + '\n');
  console.log('On first login you will confirm a 6-digit code to enable 2FA.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
