import { assertConfig, config } from './config.js';
import { createStore } from './store.js';
import { migrate } from './migrate.js';
import { seedStore } from './seed.js';
import { createApp } from './app.js';
import { tick } from '@crateline/domain/fin.js';
import { createTransport, processOutbox } from './email.js';
import { createStorage } from './files.js';
import { createPayments } from './payments.js';

assertConfig();
if (config.databaseUrl) await migrate();
const store = createStore();
await store.init();
if (await seedStore(store)) console.log('Empty store: loaded demo fixtures.');

const transport = createTransport();
const app = createApp(store, { transport, storage: createStorage(), payments: createPayments() });
const server = app.listen(config.port, () => console.log(`Crateline API on :${config.port} (${store.kind} store, simulated providers ${config.simulateProviders ? 'on' : 'off'}, email ${config.emailTransport}, files ${config.fileStorage}, payments ${config.payments})`));

// Release earnings, escalate overdue cases and apply scheduled settings every 10 minutes.
const timer = setInterval(() => store.transact(d => tick(d)).catch(e => console.error('tick failed', e)), 10 * 60e3);
// Send queued email and retry failures every 15 seconds.
const mailer = transport && setInterval(() => processOutbox(store, transport).catch(e => console.error('email worker failed', e)), 15e3);
const stop = () => { clearInterval(timer); clearInterval(mailer); server.close(() => store.close().then(() => process.exit(0))); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
