// Loads the fictional Section 18 fixtures and creates a login for every seeded buyer, seller
// and staff member, all with SEED_DEMO_PASSWORD. Replace with real onboarding before launch.
import bcrypt from 'bcryptjs';
import { seed } from '@crateline/domain/data.js';
import { config } from './config.js';
import { createStore } from './store.js';

export async function seedStore(store, { force = false } = {}) {
  if (!force && await store.hasState()) return false;
  if (!config.seedPassword) throw new Error('Set SEED_DEMO_PASSWORD before seeding.');
  const doc = seed();
  const hash = await bcrypt.hash(config.seedPassword, 10);
  const accounts = [
    ...Object.values(doc.users).map(u => ({ email: u.email, kind: 'user', refId: u.id, hash })),
    ...Object.values(doc.staff).map(s => ({ email: s.email, kind: 'staff', refId: s.id, hash })),
  ];
  await store.replace(doc, accounts);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const store = createStore();
  await store.init();
  const force = process.argv.includes('--force');
  const done = await seedStore(store, { force });
  console.log(done ? 'Seeded demo data.' : 'Data already present. Use --force to replace it.');
  await store.close();
}
