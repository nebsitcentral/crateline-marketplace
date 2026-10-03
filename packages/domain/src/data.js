// Seed data for the Crateline prototype. All records are fictional sample data.
// Financial fixtures follow Section 18 of the management specification exactly.
import { DEFAULT_SETTINGS, ROLE_TEMPLATES, recordSale, holdOrder, mv, toC, nid } from './fin.js';
export const H = 36e5, D = 864e5;
export const NOW = Date.now();
export const ago = (d, h = 0) => NOW - d * D - h * H;
export const ahead = (d, h = 0) => NOW + d * D + h * H;
export const SCHEMA = 'crateline-v2';

// Kept for older imports; live values come from settings (Demo defaults)
export const COMMISSION = 0.10;
export const SERVICE_FEE = 0;
export const RELEASE_DAYS = 3;
export const MIN_PAYOUT = 20;
export const TERMS_VERSION = 'Terms v0.9 (placeholder)';

const BASE_CATS = [
  { id: 'data', name: 'Data and leads', icon: 'database', blurb: 'Compiled contact databases and qualified lead batches',
    subs: [{ id: 'bulk-database', name: 'Bulk database', icon: 'database' }, { id: 'targeted-leads', name: 'Targeted leads', icon: 'target' }] },
  { id: 'accounts', name: 'Accounts', icon: 'mail', blurb: 'Mailbox access, sending APIs and phone numbers',
    subs: [{ id: 'email-api', name: 'Email account and API', icon: 'mail' }, { id: 'toll-free', name: 'Toll free numbers', icon: 'phone' }] },
  { id: 'server', name: 'Server and software', icon: 'server', blurb: 'Hosting, remote desktops and sending software',
    subs: [{ id: 'vps', name: 'VPS', icon: 'server' }, { id: 'rdp', name: 'Remote desktop', icon: 'monitor' }, { id: 'blasting-software', name: 'Blasting software', icon: 'send' }] },
  { id: 'services', name: 'Services', icon: 'megaphone', blurb: 'Managed teams, calls, traffic and campaigns',
    subs: [{ id: 'blasting-team', name: 'Blasting team', icon: 'users' }, { id: 'email-calls', name: 'Email calls', icon: 'headset' },
      { id: 'ppc-calls', name: 'PPC calls', icon: 'phoneCall' }, { id: 'web-traffic', name: 'Web traffic', icon: 'activity' },
      { id: 'voip', name: 'VOIP', icon: 'phone' }, { id: 'campaigns', name: 'Campaigns', icon: 'layers' }] },
];
// Live category structure. Mutated in place from the store so every screen reads the same names.
export const CATEGORIES = JSON.parse(JSON.stringify(BASE_CATS)).map((c, i) => ({ ...c, active: true, order: i, subs: c.subs.map((s, j) => ({ ...s, active: true, order: j })) }));
export const SUBS = {};
export function syncCats(cats) {
  CATEGORIES.length = 0; cats.slice().sort((a, b) => a.order - b.order).forEach(c => CATEGORIES.push({ ...c, subs: c.subs.slice().sort((a, b) => a.order - b.order) }));
  for (const k in SUBS) delete SUBS[k];
  for (const c of CATEGORIES) for (const s of c.subs) SUBS[s.id] = { ...s, cat: c.id, catName: c.name, catActive: c.active };
}
syncCats(JSON.parse(JSON.stringify(CATEGORIES)));
export const activeCats = () => CATEGORIES.filter(c => c.active).map(c => ({ ...c, subs: c.subs.filter(s => s.active) }));
export const CAT_HUE = { data: 172, accounts: 212, server: 262, services: 28 };

const USAGE = 'Buyer is responsible for lawful use, including consent, CAN-SPAM, TCPA, GDPR and Do-Not-Call scrubbing where they apply.';

function user(id, name, username, extra = {}) {
  return {
    id, name, username, email: `${username.replace(/\W/g, '')}@example.com`, phone: '', telegram: '@' + username.replace(/\W/g, ''),
    hue: (name.charCodeAt(0) * 37 + name.length * 11) % 360, acct: 'AC-' + (100400 + name.charCodeAt(0) * 3 + name.length * 7), joined: ago(200), storeId: null,
    emailVerified: true, twoFA: false, prefs: { orders: true, messages: true, offers: true, marketing: false, email: true },
    deletion: null, following: [], restrictions: [], lastActive: ago(1), ...extra,
  };
}
const staff = (id, name, roles, team, x = {}) => ({ id, name, email: name.toLowerCase().split(' ')[0] + '.' + id.toLowerCase() + '@staff.example.com', roles, activeRole: roles[0], team, active: true, twoFA: true, lastSignIn: ago(0, 3), sessions: [{ id: 'SS-' + id + '1', device: 'Chrome on macOS (simulated)', at: ago(0, 3) }], ...x });

export function seed() {
  const users = {
    u_mira: user('u_mira', 'Mira Patel', 'mira.p', { email: 'mira@example.com', phone: '+44 7700 900412', hue: 16, acct: 'AC-100482', joined: ago(240), following: ['st_atlas'] }),
    u_sami: user('u_sami', 'Sami Rahman', 'sami.r', { acct: 'AC-100501', joined: ago(180) }),
    u_lina: user('u_lina', 'Lina Ortega', 'lina.o', { acct: 'AC-100517', joined: ago(150) }),
    u_ayesha: user('u_ayesha', 'Ayesha Karim', 'ayesha.k', { acct: 'AC-100530' }),
    u_daniel: user('u_daniel', 'Daniel Brooks', 'dbrooks', { acct: 'AC-100544' }),
    u_sofia: user('u_sofia', 'Sofia Marin', 'sofia.m', { acct: 'AC-100559', deletion: { at: ago(2), blockers: [] } }),
    u_marcus: user('u_marcus', 'Marcus Lee', 'marcuslee', { acct: 'AC-100563' }),
    u_tomas: user('u_tomas', 'Tomas Novak', 'tnovak', { acct: 'AC-100578', restrictions: [{ id: 'RS-1', scope: 'purchases', reason: 'Repeated payment failures under review', notice: 'New purchases are paused while we review recent payment attempts.', by: 'Omar Farouk', at: ago(1), expiresAt: ahead(6), active: true }] }),
    u_rafi: user('u_rafi', 'Rafi Ahmed', 'rafi.atlas', { email: 'rafi@atlas.example', hue: 190, acct: 'AC-100219', joined: ago(410), storeId: 'st_atlas' }),
    u_noor: user('u_noor', 'Noor Haddad', 'noor.nova', { email: 'noor@nova.example', hue: 262, acct: 'AC-100233', joined: ago(380), storeId: 'st_nova' }),
    u_lena: user('u_lena', 'Lena Fischer', 'lena.relay', { acct: 'AC-100250', storeId: 'st_relay' }),
    u_jonah: user('u_jonah', 'Jonah Price', 'jonah.signal', { acct: 'AC-100266', storeId: 'st_signal' }),
    u_victor: user('u_victor', 'Victor Hale', 'victor.harbor', { acct: 'AC-100281', storeId: 'st_harbor' }),
    u_hasan: user('u_hasan', 'Hasan Chowdhury', 'hasan.bright', { email: 'hasan@brightline.example', hue: 48, acct: 'AC-100977', joined: ago(4), storeId: 'st_brightline' }),
    u_leila: user('u_leila', 'Leila Moradi', 'leila.kestrel', { acct: 'AC-100988', joined: ago(9), storeId: 'st_kestrel' }),
  };

  const store = (id, ownerId, name, tagline, cat, hue, x = {}) => ({ id, ownerId, name, tagline, cat, hue, status: 'Active', paused: false, joined: ago(300), completedBase: 0, country: 'United States',
    description: '', replacementTerms: 'Replacement within 7 days of delivery for items that fail the stated checks.', image: null, ...x });
  const stores = {
    st_atlas: store('st_atlas', 'u_rafi', 'Atlas Data Co.', 'Verified B2B and consumer data, refreshed monthly', 'data', 172, { country: 'Bangladesh', joined: ago(400),
      description: 'We compile and verify contact data for sales teams in the US, UK and Gulf markets. Every file is validated against bounce and duplicate checks.',
      replacementTerms: 'Free replacement for bounced or duplicate records above 3% of the delivered file, requested within 7 days.' }),
    st_nova: store('st_nova', 'u_noor', 'Nova Cloud', 'NVMe VPS and Windows remote desktops in US and EU', 'server', 252, { country: 'Germany', joined: ago(380),
      description: 'Managed virtual servers on NVMe storage with full root or admin access, provisioned manually within hours.', replacementTerms: 'Server swap or pro-rata credit if unreachable for more than 24 hours.' }),
    st_relay: store('st_relay', 'u_lena', 'Relay Ops Studio', 'Campaign software licences and managed sending teams', 'services', 285, { country: 'Netherlands', description: 'Campaign software with deliverability tooling and a managed team for opt-in email campaigns.' }),
    st_signal: store('st_signal', 'u_jonah', 'Signal Reach Media', 'Pay-per-call, traffic and campaign management', 'services', 22, { country: 'United Arab Emirates', description: 'Performance marketing billed per outcome: inbound calls, geo-filtered visits and managed campaigns.' }),
    st_harbor: store('st_harbor', 'u_victor', 'Harbor Numbers', 'Toll-free numbers with forwarding', 'accounts', 96, { status: 'Suspended', description: 'Toll-free numbers with call and SMS forwarding.', suspension: { reason: 'Numbers delivered did not match the listing; investigation open', at: ago(5), by: 'Omar Farouk' } }),
    st_brightline: store('st_brightline', 'u_hasan', 'Brightline Leads', 'Solar and roofing leads for US installers', 'data', 45, { status: 'Verification pending', country: 'Bangladesh', joined: ago(4), description: 'Exclusive solar and roofing leads collected through our own landing pages.' }),
    st_kestrel: store('st_kestrel', 'u_leila', 'Kestrel Reach', 'Appointment setting for B2B software firms', 'services', 330, { status: 'More information required', country: 'United Kingdom', joined: ago(9), description: 'SDR team booking qualified meetings for software companies.' }),
  };

  let pk = 0;
  const L = (id, storeId, sub, title, unit, method, days, pkgs, x = {}) => {
    const l = { id, storeId, cat: SUBS[sub].cat, sub, title, unit, deliveryMethod: method, deliveryDays: days, summary: x.summary || '', description: x.description || x.summary || '', features: x.features || [], why: x.why || '',
      usage: x.usage || USAGE, replacement: x.replacement || stores[storeId].replacementTerms, requirements: x.requirements || '', requiresInfo: !!x.requirements, availability: x.availability || 'Active',
      stock: 'In stock', createdAt: x.createdAt || ago(60), submittedAt: x.submittedAt || x.createdAt || ago(60), sold: x.sold || 0, art: x.art || 0, reviewNote: x.reviewNote || '', approvedAt: ['Active', 'Paused'].includes(x.availability || 'Active') ? (x.createdAt || ago(60)) : null,
      packages: pkgs.map(([name, desc, qty, price, d]) => ({ id: 'pk' + (++pk), name, desc, qty, price, days: d || days })) };
    l.versions = [{ v: 1, at: l.submittedAt, by: 'Seller', packages: JSON.parse(JSON.stringify(l.packages)), replacement: l.replacement, title: l.title }];
    return l;
  };
  const listings = [
    L('l_b2b_saas', 'st_atlas', 'bulk-database', 'Verified B2B decision-maker database, US SaaS companies', 'contacts', 'Manual file delivery', 2, [
      ['Starter', 'Director level and above, 1 state', 5000, 100], ['Growth', 'VP and C-level, up to 5 states', 10000, 200], ['Scale', 'Nationwide, all seniority filters', 25000, 450, 3]], {
      summary: 'Name, title, company, work email and LinkedIn URL for US SaaS decision makers.', features: ['Email validation within 30 days of delivery', 'Duplicate and role-address removal', 'CSV plus XLSX with column dictionary'],
      why: 'Atlas refreshes this file monthly and includes the validation report with every delivery.', requirements: 'Target states, seniority levels and any industries to exclude.', sold: 412, art: 1 }),
    L('l_uk_home', 'st_atlas', 'targeted-leads', 'Opt-in UK homeowner leads for home improvement', 'leads', 'Manual file delivery', 1, [
      ['Batch 1,000', 'England and Wales, last 60 days', 1000, 100], ['Batch 2,500', 'UK-wide, last 90 days', 2500, 230, 2]], {
      summary: 'Homeowners who requested quotes for windows, roofing or solar in the last 90 days.', features: ['Consent timestamp and source URL on every lead', 'TPS-screened phone numbers'], requirements: 'Project types and postcode areas.', sold: 233, art: 2 }),
    L('l_gulf_shop', 'st_atlas', 'bulk-database', 'Shopify store owners list, Gulf region', 'contacts', 'Manual file delivery', 2, [
      ['Regional 2,000', 'UAE and Saudi Arabia', 2000, 80], ['Full GCC 5,000', 'All six GCC countries', 5000, 180]], { summary: 'Active Shopify merchants in GCC countries with store URL, category and contact email.', sold: 98 }),
    L('l_atlas_health', 'st_atlas', 'bulk-database', 'US healthcare IT contacts, hospitals and health systems', 'contacts', 'Manual file delivery', 3, [
      ['Core 3,000', 'IT Director and above', 3000, 150], ['Full 12,000', 'All IT roles', 12000, 480, 4]], { availability: 'Pending review', submittedAt: ago(1, 4), summary: 'IT leaders at US hospitals and health systems.',
      replacement: 'No replacements after delivery.', reviewNote: 'Replacement terms conflict with the store-wide policy (7-day replacement).' }),
    L('l_atlas_old', 'st_atlas', 'targeted-leads', 'Texas solar leads (2025 batch)', 'leads', 'Manual file delivery', 1, [['Batch 200', 'Texas only', 200, 90]], { availability: 'Archived', summary: 'Archived listing kept for order history.' }),
    L('l_vps', 'st_nova', 'vps', 'NVMe VPS, 4 vCPU and 8 GB RAM, US or EU', 'months', 'Secure access information', 1, [
      ['1 month', '4 vCPU, 8 GB, 160 GB NVMe', 1, 22], ['3 months', 'Same spec', 3, 60], ['12 months', 'Same spec, snapshot backups', 12, 220]], {
      summary: 'Root access VPS with dedicated IPv4, provisioned within hours.', features: ['Dedicated IPv4', '4 TB bandwidth', 'Console access'], requirements: 'Data centre (Frankfurt or Ashburn) and operating system.', sold: 1240 }),
    L('l_rdp', 'st_nova', 'rdp', 'Windows remote desktop server with admin access', 'months', 'Secure access information', 1, [['1 month', 'Windows Server 2022', 1, 40], ['3 months', 'Same spec', 3, 110]], { summary: 'Windows Server RDP with full administrator rights.', sold: 640, art: 1 }),
    L('l_nova_storage', 'st_nova', 'vps', 'Object storage, 1 TB S3-compatible', 'TB-months', 'Secure access information', 1, [['1 TB, 1 month', 'Standard tier', 1, 12], ['1 TB, 12 months', 'Standard tier', 12, 120]], { availability: 'Paused', summary: 'S3-compatible object storage in Frankfurt.', art: 2 }),
    L('l_relay_pro', 'st_relay', 'blasting-software', 'Relay Sender Pro, campaign software licence', 'seats', 'Secure access information', 1, [['Single seat', '1 year updates', 1, 149], ['Team', '5 seats', 5, 590]], { summary: 'Campaign sender with SMTP rotation, inbox placement tests and suppression lists.', sold: 132, art: 2 }),
    L('l_relay_team', 'st_relay', 'blasting-team', 'Managed email campaign team, setup and sending', 'campaigns', 'Service delivery', 5, [['Starter', '1 campaign, up to 20k opt-in recipients', 1, 300], ['Growth', '3 campaigns, A/B testing', 3, 750, 7]], { summary: 'Our team builds, sends and reports on opt-in campaigns.', sold: 39 }),
    L('l_ppc_calls', 'st_signal', 'ppc-calls', 'Inbound pay-per-call, US home services', 'calls', 'Service delivery', 7, [['25 calls', '60s+ billable', 25, 375], ['50 calls', '60s+ billable, 2 trades', 50, 700, 10]], { summary: 'Qualified inbound calls from homeowners for HVAC, roofing or plumbing.', sold: 87, art: 1 }),
    L('l_traffic', 'st_signal', 'web-traffic', 'Geo-targeted website traffic, 30 days', 'visits', 'Service delivery', 2, [['10k visits', 'Tier 1 countries', 10000, 40], ['50k visits', 'Up to 3 countries', 50000, 170]], { summary: 'Real-browser visits with a UTM report.', sold: 702, availability: 'Changes requested', reviewNote: 'Explain traffic sources and how bot traffic is filtered before publication.', art: 2 }),
    L('l_campaigns', 'st_signal', 'campaigns', 'Multichannel campaign management, 30 days', 'campaigns', 'Service delivery', 3, [['Launch', 'Email plus paid social, 1 market', 1, 900], ['Expand', '3 markets', 1, 2100]], { summary: 'Strategy, creative, launch and weekly optimisation.', art: 1 }),
    L('l_tollfree', 'st_harbor', 'toll-free', 'US toll-free numbers (800/888) with forwarding', 'numbers', 'Secure access information', 1, [['1 number', '1 month', 1, 18], ['5 numbers', '1 month, call tracking', 5, 85]], { summary: 'Toll-free numbers with a forwarding dashboard.', sold: 188 }),
    L('l_bright_solar', 'st_brightline', 'targeted-leads', 'Exclusive solar installation leads, Texas', 'leads', 'Manual file delivery', 1, [['50 leads', 'Houston and Dallas', 50, 150]], { availability: 'Draft', summary: 'Homeowners who requested a solar quote.' }),
    L('l_kestrel_sdr', 'st_kestrel', 'email-calls', 'Appointment setting for SaaS, 10 meetings', 'meetings', 'Service delivery', 14, [['10 meetings', 'One persona', 10, 900]], { availability: 'Draft', summary: 'Qualified discovery meetings booked into your calendar.' }),
  ];

  const R = (listingId, rating, text, alias, pkg, d) => ({ id: 'rv_' + listingId + d, listingId, rating, text, alias, pkg, at: ago(d), reply: null });
  const reviews = [R('l_b2b_saas', 5, 'Bounce rate came in under 2% on our first send.', 'S***i', 'Growth', 4), R('l_b2b_saas', 4, 'Good data, a few role addresses were replaced quickly.', 'K***a', 'Starter', 41),
    R('l_vps', 5, 'Provisioned in under two hours.', 'A***a', '3 months', 30), R('l_rdp', 5, 'Admin rights as promised.', 'R***i', '1 month', 9), R('l_relay_pro', 5, 'Inbox placement tests are the best part.', 'A***a', 'Single seat', 60)];

  const roles = Object.fromEntries(Object.entries(ROLE_TEMPLATES).map(([id, t]) => [id, { id, ...JSON.parse(JSON.stringify(t)), version: 1, history: [] }]));
  const staffList = [
    staff('SA-01', 'Sofia Lindqvist', ['superadmin'], 'Leadership'), staff('SA-02', 'Kwame Mensah', ['superadmin'], 'Leadership'),
    staff('FIN-01', 'Felix Brandt', ['finance'], 'Finance'), staff('FIN-02', 'Priya Sen', ['dispute', 'finance'], 'Finance and disputes'),
    staff('SUP-01', 'Sam Okafor', ['support'], 'Support'), staff('VER-01', 'Vera Ilic', ['verification'], 'Trust'),
    staff('CAT-01', 'Chen Wei', ['catalog'], 'Catalog'), staff('DSP-01', 'Dana Reyes', ['dispute'], 'Disputes'), staff('OPS-01', 'Omar Farouk', ['ops'], 'Operations'),
  ];

  const db = {
    schema: SCHEMA, clockOffset: 0,
    seq: { ORD: 1007, PG: 5006, PMT: 7006, CASE: 3002, PAY: 1002, RF: 3002, APR: 4, OF: 702, MSG: 1, N: 1, TK: 505, LE: 1, PE: 1, AU: 1, SN: 1, EV: 1, SV: 1, TSK: 4, RC: 4, VR: 210, INV: 3, BN: 3, RP: 3, RS: 2 },
    users, stores, listings, reviews, roles, staff: Object.fromEntries(staffList.map(s => [s.id, s])),
    categories: JSON.parse(JSON.stringify(CATEGORIES)),
    carts: { u_mira: [{ id: 'ci1', listingId: 'l_vps', pkgId: listings.find(l => l.id === 'l_vps').packages[0].id, count: 1 }] },
    purchases: [], payments: [], orders: [], conversations: [], offers: [], cases: [], notifications: [], payouts: [], refunds: [], tickets: [],
    ledger: [], platform: [], approvals: [], audit: [], staffNotes: [], events: [], processedOps: [], blocked: [], assign: {}, notes: {},
    recon: [], tasks: [], invites: [], securityEvents: [], exports: [], holds: {}, reports: [],
    verifications: [], settings: { current: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), versions: [] },
    integrations: [
      { id: 'INT-card', name: 'Card processor (demo)', kind: 'Card', methods: ['Card'], currencies: ['USD'], markets: ['United States', 'United Kingdom', 'United Arab Emirates'], mode: 'Test', enabled: true, callback: 'Receiving (simulated)', health: 'Operational', lastCheck: ago(0, 1), keyLabel: 'pk_test_••••4f2a', failures: 0 },
      { id: 'INT-crypto', name: 'Crypto gateway (demo)', kind: 'Crypto', methods: ['Crypto'], currencies: ['USD'], markets: ['All configured markets'], mode: 'Test', enabled: true, callback: 'Receiving (simulated)', health: 'Degraded', lastCheck: ago(0, 2), keyLabel: 'ck_test_••••9c10', failures: 2,
        crypto: { pairs: [['USDT', 'Tron (TRC-20)'], ['USDT', 'Ethereum (ERC-20)'], ['USDC', 'Base']], precision: 6, quoteMinutes: 30, confirmations: 12, underpayment: 'Reconciliation queue; never auto-complete', late: 'Reconciliation queue after quote expiry' } },
      { id: 'INT-bkash', name: 'bKash (demo)', kind: 'Mobile wallet', methods: ['bKash'], currencies: ['USD'], markets: ['Bangladesh'], mode: 'Test', enabled: true, callback: 'Receiving (simulated)', health: 'Operational', lastCheck: ago(0, 1), keyLabel: 'bk_test_••••77ad', failures: 0, payoutMethods: ['bKash'] },
      { id: 'INT-nagad', name: 'Nagad (demo)', kind: 'Mobile wallet', methods: ['Nagad'], currencies: ['USD'], markets: ['Bangladesh'], mode: 'Test', enabled: true, callback: 'Not configured', health: 'Not configured', lastCheck: null, keyLabel: '', failures: 0, payoutMethods: ['Nagad'] },
    ],
    payoutConfig: [['Bank', true, 'Account holder, bank, account or IBAN', true, 2000, 500000], ['Crypto', true, 'Network, wallet address', true, 2000, 200000], ['PayPal', false, 'Account email', true, 2000, 100000], ['Payoneer', true, 'Account email', true, 2000, 500000], ['bKash', true, 'Wallet number', true, 2000, 50000], ['Nagad', false, 'Wallet number', true, 2000, 50000], ['UPI', false, 'UPI ID', true, 2000, 50000]]
      .map(([type, enabled, fields, verify, minC, maxC]) => ({ type, enabled, currencies: ['USD'], fields, verify, minC, maxC, feeC: 0, notes: enabled ? 'Manual processing in demo' : 'Not enabled in demo' })),
    payoutMethods: {
      st_atlas: [{ id: 'pm1', type: 'Bank', label: 'Dutch-Bangla Bank •••• 4412', holder: 'Rafi Ahmed', verified: true, primary: true }, { id: 'pm2', type: 'Payoneer', label: 'Payoneer r•••@atlas.example', holder: 'Rafi Ahmed', verified: true }],
      st_nova: [{ id: 'pm3', type: 'Bank', label: 'Sparkasse •••• 0921', holder: 'Noor Haddad', verified: true, primary: true }],
    },
    payoutSettings: { st_atlas: { threshold: 2000, schedule: 'Manual' }, st_nova: { threshold: 2000, schedule: 'Manual' } },
    content: {
      banners: [{ id: 'BN-1', title: 'Verified data, delivered privately', sub: 'Every file arrives inside your order with a Resolution Center behind it.', link: 'search:data', order: 1, state: 'Active', start: ago(10), end: ahead(30), hue: 172 },
        { id: 'BN-2', title: 'Hosting week: VPS from $22', sub: 'NVMe servers provisioned within hours.', link: '', order: 2, state: 'Draft', start: ahead(1), end: ahead(8), hue: 252 }],
      featured: ['l_b2b_saas', 'l_vps', 'l_relay_pro'],
      faqs: [['When is the seller paid?', 'Earnings are released 3 days after the order completes (demo default). Orders with an open case stay on hold.'], ['What if a delivery is wrong?', 'Request a replacement within 7 days, or report the order to open a Resolution Center case.'], ['Which payment methods are available?', 'Card, crypto, bKash and Nagad are shown. All payments in this prototype are simulated.']],
      announcements: [{ id: 'AN-1', text: 'Scheduled maintenance window on Sunday 02:00 to 03:00 UTC (demo).', state: 'Draft' }],
    },
    policies: [
      { id: 'POL-terms', title: 'Terms and Conditions', versions: [{ v: '0.9', state: 'Published', content: '[Placeholder] Accounts, buying, selling, acceptable use and disputes. Final legal text is a separate approved deliverable.', author: 'Sofia Lindqvist', publishedAt: ago(30) }, { v: '1.0', state: 'Draft', content: '[Placeholder] Adds the 3-day earnings release and the 48-hour dispute response rule.', author: 'Chen Wei' }] },
      { id: 'POL-privacy', title: 'Privacy Policy', versions: [{ v: '0.9', state: 'Published', content: '[Placeholder] What we collect, how it is used, retention and your rights.', author: 'Sofia Lindqvist', publishedAt: ago(30) }] },
      { id: 'POL-refunds', title: 'Purchase, delivery and refunds', versions: [{ v: '0.9', state: 'Published', content: '[Placeholder] One checkout may include several sellers; each order is delivered and resolved separately.', author: 'Sofia Lindqvist', publishedAt: ago(30) }] },
    ],
    scenario: { provider: 'success', notifyFail: false, testConn: 'success', pageError: false },
  };

  // ---- verification submissions
  db.verifications.push(
    { id: 'VR-201', storeId: 'st_brightline', version: 1, submittedAt: ago(3), state: 'Verification pending', identity: { name: 'Hasan Chowdhury', dob: '1990-04-12', country: 'Bangladesh', document: 'National ID card (placeholder image)' }, business: { name: 'Brightline Leads', address: 'House 12, Road 5, Dhanmondi, Dhaka (fictional)', registration: 'TRAD/DNCC/0001 (fictional)' },
      checks: { email: true, identity: true, address: true, sanctions: false }, evidence: [{ name: 'national_id_front_PLACEHOLDER.png', size: 410000 }, { name: 'trade_licence_PLACEHOLDER.pdf', size: 820000 }], decisions: [], missing: [] },
    { id: 'VR-198', storeId: 'st_kestrel', version: 1, submittedAt: ago(8), state: 'More information required', identity: { name: 'Leila Moradi', dob: '1988-11-02', country: 'United Kingdom', document: 'Passport (placeholder image)' }, business: { name: 'Kestrel Reach Ltd', address: '', registration: '' },
      checks: { email: true, identity: true, address: false, sanctions: true }, evidence: [{ name: 'passport_PLACEHOLDER.png', size: 512000 }], decisions: [{ at: ago(6), by: 'Vera Ilic', decision: 'Request information', reason: 'Business address and registration number are missing; no proof of address was attached.', fields: ['Business address', 'Company registration number', 'Proof of address'] }], missing: ['Business address', 'Company registration number', 'Proof of address'] },
    { id: 'VR-120', storeId: 'st_atlas', version: 1, submittedAt: ago(402), state: 'Approved', identity: { name: 'Rafi Ahmed', dob: '1991', country: 'Bangladesh', document: 'National ID (placeholder)' }, business: { name: 'Atlas Data Co.', address: 'Gulshan, Dhaka (fictional)', registration: 'fictional' }, checks: { email: true, identity: true, address: true, sanctions: true }, evidence: [], decisions: [{ at: ago(400), by: 'Vera Ilic', decision: 'Approve', reason: 'All checks complete' }], missing: [] },
    { id: 'VR-121', storeId: 'st_nova', version: 1, submittedAt: ago(382), state: 'Approved', identity: { name: 'Noor Haddad', dob: '1987', country: 'Germany', document: 'Passport (placeholder)' }, business: { name: 'Nova Cloud GmbH (fictional)', address: 'Frankfurt (fictional)', registration: 'fictional' }, checks: { email: true, identity: true, address: true, sanctions: true }, evidence: [], decisions: [{ at: ago(380), by: 'Vera Ilic', decision: 'Approve', reason: 'All checks complete' }], missing: [] },
  );

  // ---- orders (Section 18)
  const LS = id => listings.find(l => l.id === id);
  const snap = (l, pkg) => ({ listingId: l.id, title: l.title, sub: l.sub, cat: l.cat, unit: l.unit, pkgId: pkg.id, pkgName: pkg.name, pkgDesc: pkg.desc, qty: pkg.qty, price: pkg.price, days: pkg.days, deliveryMethod: l.deliveryMethod, replacement: l.replacement, usage: l.usage, storeName: stores[l.storeId].name, art: l.art, listingVersion: 1 });
  const E = (at, actor, text, kind = 'info') => ({ id: 'e' + Math.round(at) + text.length, at, actor, text, kind });
  function order(id, pg, buyerId, lid, pIdx, placedAgo, status, x = {}) {
    const l = LS(lid), pkg = l.packages[pIdx], placed = ago(placedAgo);
    const o = { id, purchaseRef: pg, buyerId, storeId: l.storeId, snap: snap(l, pkg), count: 1, totalQty: pkg.qty, subtotal: pkg.price, fee: 0, total: pkg.price,
      payment: { method: x.method || 'Card', status: x.payStatus || 'Paid', ref: x.payRef }, status, placedAt: placed, dueAt: placed + pkg.days * D, requirements: x.requirements || '',
      infoRequest: null, deliveries: [], events: [E(placed, 'Buyer', 'Order placed')], caseId: null, extension: null, replacement: null, cancelRequest: null, refund: null, completedAt: null,
      archivedBySeller: false, review: null, fromOfferId: null, termsVersion: TERMS_VERSION, commissionRate: 0.10, commissionRule: 'Platform default', version: 1 };
    if (o.payment.status === 'Paid') o.events.push(E(placed + 6e4, 'System', `Payment verified (${o.payment.method}, simulated)`, 'ok'));
    db.orders.push(o); return o;
  }
  const deliver = (o, at, note, file) => { o.events.push(E(o.placedAt + 2 * H, 'Seller', 'Started preparation')); o.deliveries.push({ v: 1, at, note, file: { name: file, size: 1843200 }, qty: o.totalQty, kind: 'Delivery' }); o.events.push(E(at, 'Seller', `Delivered ${o.totalQty.toLocaleString('en-US')} ${o.snap.unit}. Awaiting buyer confirmation`, 'ok')); };

  const o1 = order('ORD-1001', 'PG-5001', 'u_mira', 'l_b2b_saas', 0, 3, 'delivered', { requirements: 'California only. Director and above.', payRef: 'PMT-7001' });
  deliver(o1, ago(1, 6), 'File attached with validation report. 5,000 records, 1.8% predicted bounce.', 'atlas_saas_ca_5k.csv');
  const o4 = order('ORD-1004', 'PG-5001', 'u_mira', 'l_vps', 1, 3, 'preparing', { requirements: 'Frankfurt, Ubuntu 24.04', payRef: 'PMT-7001' });
  o4.dueAt = ago(2); o4.events.push(E(ago(2, 20), 'Seller', 'Started preparation'));
  const o2 = order('ORD-1002', 'PG-5002', 'u_sami', 'l_b2b_saas', 1, 12, 'completed', { requirements: 'Texas and Florida, VP and above.', method: 'bKash', payRef: 'PMT-7002' });
  deliver(o2, ago(11), 'Full file attached.', 'atlas_saas_10k.csv'); o2.completedAt = ago(10); o2.events.push(E(ago(10), 'Buyer', 'Confirmed order received. Order completed', 'ok'));
  const o3 = order('ORD-1003', 'PG-5003', 'u_lina', 'l_uk_home', 0, 6, 'delivered', { requirements: 'Roofing only, North West England.', method: 'Crypto', payRef: 'PMT-7003' });
  deliver(o3, ago(5), 'Batch attached with consent log.', 'uk_home_roofing_1000.csv');
  o3.caseId = 'CASE-3001'; o3.events.push(E(ago(2), 'Buyer', 'Opened case CASE-3001', 'warn'));
  const o5 = order('ORD-1005', 'PG-5004', 'u_sami', 'l_rdp', 0, 1, 'unpaid', { method: 'bKash', payStatus: 'Failed', payRef: 'PMT-7004' });
  o5.events.push(E(ago(1, -1), 'System', 'Payment failed at provider (simulated). Order not started', 'bad'));
  const o6 = order('ORD-1006', 'PG-5005', 'u_lina', 'l_gulf_shop', 0, 2, 'unpaid', { method: 'Crypto', payStatus: 'Expired', payRef: 'PMT-7005' });
  o6.events.push(E(ago(2, -1), 'System', 'Crypto quote expired before payment (simulated)', 'warn'));

  // purchases and payments
  const purchase = (id, buyerId, orderIds, method, status, at, net) => {
    const total = orderIds.reduce((a, oid) => a + db.orders.find(o => o.id === oid).total, 0);
    db.purchases.push({ id, buyerId, at, method, net: net || null, subtotal: total, fee: 0, total, status, termsVersion: TERMS_VERSION, items: orderIds.map(oid => { const o = db.orders.find(x => x.id === oid); return { listingId: o.snap.listingId, pkgId: o.snap.pkgId, count: 1, title: o.snap.title, storeId: o.storeId, price: o.subtotal }; }), ordersCreated: true, orderIds, fromCart: false, cartIds: [] });
  };
  purchase('PG-5001', 'u_mira', ['ORD-1001', 'ORD-1004'], 'Card', 'Paid', ago(3));
  purchase('PG-5002', 'u_sami', ['ORD-1002'], 'bKash', 'Paid', ago(12));
  purchase('PG-5003', 'u_lina', ['ORD-1003'], 'Crypto', 'Paid', ago(6), 'USDT on Tron (TRC-20)');
  purchase('PG-5004', 'u_sami', ['ORD-1005'], 'bKash', 'Failed', ago(1));
  purchase('PG-5005', 'u_lina', ['ORD-1006'], 'Crypto', 'Expired', ago(2), 'USDT on Tron (TRC-20)');
  const pay = (id, pg, state, provRef, events) => { const p = db.purchases.find(x => x.id === pg); db.payments.push({ id, purchaseId: pg, buyerId: p.buyerId, method: p.method, net: p.net, amountC: toC(p.total), cur: 'USD', providerRef: provRef, state, initiatedAt: p.at, lastEventAt: events[events.length - 1].at, events, orderIds: p.orderIds }); };
  pay('PMT-7001', 'PG-5001', 'Paid', 'ch_demo_8812', [{ op: 'EVT-8812-a', at: ago(3, -0.02), type: 'payment.succeeded', status: 'Processed' }, { op: 'EVT-8812-a', at: ago(3, -1), type: 'payment.succeeded (repeat)', status: 'Duplicate ignored' }]);
  pay('PMT-7002', 'PG-5002', 'Paid', 'bk_demo_2210', [{ op: 'EVT-2210', at: ago(12), type: 'payment.completed', status: 'Processed' }]);
  pay('PMT-7003', 'PG-5003', 'Paid', 'cx_demo_0071', [{ op: 'EVT-0071', at: ago(6), type: 'crypto.confirmed (12 confirmations)', status: 'Processed' }]);
  pay('PMT-7004', 'PG-5004', 'Failed', 'bk_demo_3390', [{ op: 'EVT-3390', at: ago(1, -1), type: 'payment.failed: insufficient balance', status: 'Processed' }]);
  pay('PMT-7005', 'PG-5005', 'Expired', 'cx_demo_0090', [{ op: 'EVT-0090', at: ago(2, -1), type: 'quote.expired', status: 'Processed' }]);

  // ledger fixtures
  for (const o of [o2, o1, o3, o4]) recordSale(db, o, o.placedAt + 6e4);
  mv(db, { at: ago(7), store: 'st_atlas', order: 'ORD-1002', kind: 'Earnings released', from: 'pending', to: 'available', amt: 18000 });
  // CASE-3001 on ORD-1003 with hold and a USD 20 partial refund awaiting independent approval
  db.cases.push({ id: 'CASE-3001', orderId: 'ORD-1003', buyerId: 'u_lina', storeId: 'st_atlas', status: 'Awaiting seller', openedAt: ago(2), deadline: ahead(0, 30), escalation: 0, version: 3, holdActive: true,
    reason: 'Delivery does not match description', outcome: 'Partial refund', description: '200 of the 1,000 leads are outside North West England and 20 have invalid phone numbers.',
    evidence: [{ name: 'postcode_check.xlsx', size: 284000, by: 'Buyer', at: ago(2) }], responses: [{ from: 'buyer', at: ago(2), text: 'Postcode check attached. I would like a partial refund.' }, { from: 'seller', at: ago(1, 10), text: 'We can replace the 200 out-of-area records. The phone numbers were valid at delivery.' }],
    internal: [{ by: 'Priya Sen', at: ago(1, 2), text: 'Spot check: 20 numbers fail format validation. Seller accepts partial refund for those.' }],
    staffMsgs: [{ by: 'Marketplace support', at: ago(1, 1), text: 'We reviewed the evidence and are proposing a USD 20 partial refund for the invalid numbers. The out-of-area replacement remains with the seller.' }],
    proposal: null, remedy: { type: 'Partial refund', amountC: 2000, state: 'Awaiting refund', refundId: 'RF-3001', decidedBy: 'Priya Sen', rationale: '20 records fail validation (2% of file).', evidence: ['postcode_check.xlsx'], closeOnRefund: false },
    timeline: [E(ago(2), 'Buyer', 'Case opened'), E(ago(2), 'System', 'Seller earnings for ORD-1003 (USD 90.00) placed on hold', 'warn'), E(ago(1, 10), 'Seller', 'Responded'), E(ago(1, 1), 'Priya Sen', 'Decision: partial refund USD 20.00 with rationale and selected evidence')] });
  holdOrder(db, o3, 'CASE-3001', ago(2));
  db.assign['case:CASE-3001'] = { assigneeId: 'FIN-02', priority: 'High', history: [{ at: ago(1, 3), by: 'Omar Farouk', to: 'Priya Sen', reason: 'Dispute specialist' }] };
  db.refunds.push({ id: 'RF-3001', orderId: 'ORD-1003', caseId: 'CASE-3001', storeId: 'st_atlas', amountC: 2000, cur: 'USD', reason: 'Partial refund for 20 invalid records (CASE-3001)', requesterId: 'FIN-02', requestedBy: 'Priya Sen (Dispute Admin)', status: 'Requested', createdAt: ago(1), version: 1, opRef: 'OP-RF-3001A', attempts: [], approvalId: 'APR-1' });
  o3.refund = { amount: 20, state: 'Requested', at: ago(1) };
  db.approvals.push({ id: 'APR-1', type: 'refund', ref: 'RF-3001', amountC: 2000, requesterId: 'FIN-02', requester: 'Priya Sen (Dispute Admin)', title: 'Refund RF-3001 for ORD-1003', reason: 'Partial refund for 20 invalid records (CASE-3001)', before: 'Refunded $0.00', after: 'Refund $20.00 of $100.00', requiredAuthority: 'Finance Admin (up to $100.00) or Super Admin', status: 'Pending', createdAt: ago(1), expiresAt: ahead(6), comments: [], version: 1 });
  // PAY-1001 reserves USD 50
  db.payouts.push({ id: 'PAY-1001', storeId: 'st_atlas', amountC: 5000, feeC: 0, cur: 'USD', method: 'Bank', methodId: 'pm1', dest: 'Dutch-Bangla Bank •••• 4412', destVerified: true, status: 'Awaiting approval', requestedAt: ago(0, 20), version: 1, opRef: 'OP-PO-1001A', attempts: [], approvalId: 'APR-2', provider: 'Demo bank transfer' });
  mv(db, { at: ago(0, 20), store: 'st_atlas', payout: 'PAY-1001', kind: 'Payout reserved', from: 'available', to: 'reserved', amt: 5000 });
  db.approvals.push({ id: 'APR-2', type: 'payout', ref: 'PAY-1001', amountC: 5000, requesterId: 'u_rafi', requester: 'Rafi Ahmed (seller)', title: 'Payout PAY-1001 for Atlas Data Co.', reason: 'Seller payout request', before: 'Available $180.00', after: 'Reserve $50.00 to Dutch-Bangla Bank •••• 4412', requiredAuthority: 'Finance Admin (up to $500.00) or Super Admin', status: 'Pending', createdAt: ago(0, 20), expiresAt: ahead(6), comments: [], version: 1 });
  // A pending commission change awaiting a second Super Admin
  db.settings.versions.push({ id: 'SV-1', key: 'commissionDefault', from: 0.10, to: 0.12, reason: 'Align with competitor benchmark (demo)', by: 'Kwame Mensah', byId: 'SA-02', at: ago(0, 8), effectiveAt: ahead(7), state: 'Pending approval', approvalId: 'APR-3' });
  db.approvals.push({ id: 'APR-3', type: 'setting', ref: 'SV-1', requesterId: 'SA-02', requester: 'Kwame Mensah', title: 'Setting change: commissionDefault', reason: 'Align with competitor benchmark (demo)', before: '0.1', after: '0.12', requiredAuthority: 'Super Admin, other than the requester', status: 'Pending', createdAt: ago(0, 8), expiresAt: ahead(6), comments: [], version: 1 });
  db.seq.SV = 2;

  // conversations and offers
  const m = (id, from, at, text, x = {}) => ({ id, from, at, text, ...x });
  db.conversations.push(
    { id: 'c1', buyerId: 'u_mira', storeId: 'st_atlas', listingId: 'l_b2b_saas', orderId: 'ORD-1001', unread: { buyer: 1, seller: 0 }, hidden: {}, blocked: false, messages: [m('m1', 'buyer', ago(3, -1), 'Please prioritise companies with 50 to 500 employees.'), m('m2', 'seller', ago(3, -2), 'Will do.'), m('m3', 'system', ago(1, 6), 'Order ORD-1001 delivered.', { kind: 'event', orderId: 'ORD-1001' })] },
    { id: 'c2', buyerId: 'u_lina', storeId: 'st_atlas', listingId: 'l_uk_home', orderId: 'ORD-1003', unread: { buyer: 0, seller: 0 }, hidden: {}, blocked: false, messages: [m('m4', 'buyer', ago(2, 1), 'Many of these leads are outside North West England.'), m('m5', 'seller', ago(2), 'Please send the postcodes and we will check.'), m('m6', 'system', ago(2), 'Case CASE-3001 opened on ORD-1003.', { kind: 'event', orderId: 'ORD-1003' })] },
    { id: 'c3', buyerId: 'u_mira', storeId: 'st_nova', listingId: 'l_vps', orderId: 'ORD-1004', unread: { buyer: 0, seller: 1 }, hidden: {}, blocked: false, messages: [m('m7', 'buyer', ago(1), 'My VPS was due yesterday. Any update?')] },
    { id: 'c4', buyerId: 'u_daniel', storeId: 'st_atlas', listingId: 'l_b2b_saas', orderId: null, unread: { buyer: 0, seller: 1 }, hidden: {}, blocked: false, messages: [m('m8', 'buyer', ago(0, 6), 'Can you quote 120,000 healthcare IT contacts?', { offerId: 'OF-700' })] },
  );
  db.seq.MSG = 20;
  db.offers.push({ id: 'OF-700', convId: 'c4', kind: 'request', listingId: 'l_b2b_saas', storeId: 'st_atlas', buyerId: 'u_daniel', qty: 120000, requirements: 'US hospitals and health systems. IT Director and above.', budget: null, status: 'Requested', at: ago(0, 6), version: 0 });

  // tickets
  const T = (id, userId, subject, cat, priority, status, at, x = {}) => ({ id, userId, name: users[userId]?.name || x.name, email: users[userId]?.email || x.email, subject, cat, priority, status, at, order: x.order || '', link: x.link || null, deadline: at + (priority === 'High' ? 8 : 24) * H, desc: x.desc || subject,
    thread: [{ kind: 'public', from: 'customer', by: users[userId]?.name || x.name, at, text: x.desc || subject }, ...(x.thread || [])], lastResponse: x.last || at });
  db.tickets.push(
    T('TK-501', 'u_mira', 'My VPS order is late', 'Order issue', 'High', 'Open', ago(0, 20), { order: 'ORD-1004', desc: 'ORD-1004 was due two days ago and the seller has not delivered.' }),
    T('TK-502', 'u_lina', 'Refund timing for my case', 'Payment', 'Normal', 'Assigned', ago(1), { order: 'ORD-1003', link: 'CASE-3001', desc: 'When will I get the partial refund?', thread: [{ kind: 'internal', from: 'staff', by: 'Sam Okafor', at: ago(0, 22), text: 'Refund RF-3001 is awaiting Finance approval. Do not promise a date.' }] }),
    T('TK-503', null, 'Can I pay in BDT?', 'Other', 'Low', 'Awaiting customer', ago(4), { name: 'Guest visitor', email: 'guest@example.com', thread: [{ kind: 'public', from: 'staff', by: 'Sam Okafor', at: ago(3), text: 'Checkout currently uses USD. Which payment method do you plan to use?' }], last: ago(3) }),
    T('TK-504', 'u_rafi', 'When will PAY-1001 arrive?', 'Selling', 'Normal', 'Awaiting internal action', ago(0, 18), { link: 'PAY-1001' }),
  );
  db.assign['ticket:TK-502'] = { assigneeId: 'SUP-01', priority: 'Normal', history: [] };
  db.assign['ticket:TK-503'] = { assigneeId: 'SUP-01', priority: 'Low', history: [] };
  db.assign['seller:st_kestrel'] = { assigneeId: 'VER-01', priority: 'Normal', history: [] };

  // reconciliation queue and failed tasks
  db.recon.push(
    { id: 'RC-1', type: 'Duplicate notification', paymentId: 'PMT-7001', ref: 'EVT-8812-a', amountC: 16000, status: 'Open', at: ago(3, -1), detail: 'The card provider sent payment.succeeded twice for PG-5001. The first was processed.' },
    { id: 'RC-2', type: 'Late confirmation', paymentId: 'PMT-7005', ref: 'RCPT-7781', amountC: 8000, status: 'Open', at: ago(1), detail: '80.000000 USDT on Tron received 47 minutes after the quote for PG-5005 expired.', receipt: { ref: 'RCPT-7781', amount: '80.000000 USDT', network: 'Tron (TRC-20)', verified: true } },
    { id: 'RC-3', type: 'Crypto underpayment', paymentId: null, ref: 'RCPT-7790', amountC: 3950, status: 'Open', at: ago(0, 10), detail: '39.500000 USDT received with memo PG-5004 (expected 40.00). No eligible unpaid purchase matches this amount.', receipt: { ref: 'RCPT-7790', amount: '39.500000 USDT', network: 'Tron (TRC-20)', verified: true } },
  );
  db.tasks.push(
    { id: 'TSK-1', type: 'Notification email', ref: 'n-lina-1', refLabel: 'Lina Ortega: case CASE-3001 update', attempts: 3, lastError: 'Simulated mail relay timeout', status: 'Failed', at: ago(1) },
    { id: 'TSK-2', type: 'Payment status query', ref: 'PMT-7004', refLabel: 'PG-5004 bKash status query', attempts: 2, lastError: 'Provider timeout (simulated)', status: 'Failed', at: ago(0, 22) },
    { id: 'TSK-3', type: 'Search index rebuild', ref: 'catalog', refLabel: 'Catalog search index', attempts: 1, lastError: 'Worker restarted (simulated)', status: 'Failed', at: ago(0, 5) },
  );
  db.reports.push({ id: 'RP-1', listingId: 'l_traffic', reason: 'Traffic appears to be bots', reporter: 'u_daniel', at: ago(3), status: 'Open', evidence: 'analytics_screenshot_PLACEHOLDER.png' }, { id: 'RP-2', listingId: 'l_tollfree', reason: 'Numbers delivered were not toll-free', reporter: 'u_marcus', at: ago(6), status: 'Linked to store suspension', evidence: '' });
  db.invites.push({ id: 'INV-1', email: 'new.finance@staff.example.com', role: 'finance', by: 'Sofia Lindqvist', at: ago(2), expiresAt: ahead(5), status: 'Pending' }, { id: 'INV-2', email: 'temp.support@staff.example.com', role: 'support', by: 'Kwame Mensah', at: ago(12), expiresAt: ago(5), status: 'Expired' });
  db.securityEvents.push(
    { id: 'SE-1', at: ago(0, 3), type: 'Sign-in', who: 'Sofia Lindqvist', detail: 'Successful sign-in with second factor (simulated)', status: 'Normal' },
    { id: 'SE-2', at: ago(0, 9), type: 'Repeated failures', who: 'omar.ops-01@staff.example.com', detail: '6 failed sign-in attempts in 10 minutes from one address (simulated)', status: 'Investigating' },
    { id: 'SE-3', at: ago(4), type: 'Session revoked', who: 'Chen Wei', detail: 'Lost laptop reported; all sessions revoked by Kwame Mensah', status: 'Resolved' },
  );

  // notifications
  const N = (userId, panel, at, text, route, read = false) => db.notifications.push({ id: 'n' + db.seq.N++, userId, panel, at, text, route, read, delivery: 'Delivered' });
  N('u_mira', 'buyer', ago(1, 6), 'ORD-1001 was delivered. Review and confirm receipt.', { page: 'u-order', id: 'ORD-1001' });
  N('u_lina', 'buyer', ago(1, 1), 'Case CASE-3001: marketplace support proposed a partial refund of $20.00.', { page: 'case', id: 'CASE-3001' });
  N('u_rafi', 'seller', ago(2), 'Case CASE-3001 opened on ORD-1003. $90.00 is on hold.', { page: 'case', id: 'CASE-3001' });
  N('u_rafi', 'seller', ago(0, 20), 'Payout PAY-1001 requested. $50.00 reserved pending approval.', { page: 's-payouts' });
  N('u_noor', 'seller', ago(0, 2), 'ORD-1004 is past its delivery deadline.', { page: 's-order', id: 'ORD-1004' });
  N('u_leila', 'seller', ago(6), 'Verification: more information needed (business address, registration number, proof of address).', { page: 's-onboarding' });
  N('u_hasan', 'seller', ago(3), 'Verification submitted. Review in progress.', { page: 's-onboarding' });
  N('u_victor', 'seller', ago(5), 'Your store is suspended: numbers delivered did not match the listing. Existing orders remain accessible.', { page: 's-overview' });
  db.staffNotes.push(
    { id: 'SN-a', staffId: 'FIN-01', type: 'Approval request', text: 'Refund RF-3001 for ORD-1003 needs approval.', route: { page: 'sa-approval', id: 'APR-1' }, at: ago(1), read: false },
    { id: 'SN-b', staffId: 'FIN-01', type: 'Approval request', text: 'Payout PAY-1001 for Atlas Data Co. needs approval.', route: { page: 'sa-approval', id: 'APR-2' }, at: ago(0, 20), read: false },
    { id: 'SN-c', staffId: 'SA-01', type: 'Approval request', text: 'Setting change: commissionDefault needs approval.', route: { page: 'sa-approval', id: 'APR-3' }, at: ago(0, 8), read: false },
    { id: 'SN-d', staffId: 'OPS-01', type: 'Overdue work', text: 'ORD-1004 is past its delivery deadline.', route: { page: 'a-order', id: 'ORD-1004' }, at: ago(0, 2), read: false },
    { id: 'SN-e', staffId: 'VER-01', type: 'New assignment', text: 'Brightline Leads verification submitted.', route: { page: 'a-seller', id: 'st_brightline' }, at: ago(3), read: false },
    { id: 'SN-f', staffId: 'FIN-02', type: 'New assignment', text: 'CASE-3001 assigned to you.', route: { page: 'a-case', id: 'CASE-3001' }, at: ago(1, 3), read: true },
  );
  db.audit.push(
    { id: 'AU-s3', at: ago(1, 1), actorId: 'FIN-02', actor: 'Priya Sen', role: 'Dispute Admin', action: 'Case decision recorded', object: 'CASE-3001', reason: '20 records fail validation', before: 'No decision', after: 'Partial refund $20.00', approval: 'APR-1', outcome: 'Success' },
    { id: 'AU-s2', at: ago(5), actorId: 'OPS-01', actor: 'Omar Farouk', role: 'Operations Manager', action: 'Store suspended', object: 'st_harbor', reason: 'Numbers delivered did not match the listing', before: 'Active', after: 'Suspended', approval: null, outcome: 'Success' },
    { id: 'AU-s1', at: ago(6), actorId: 'VER-01', actor: 'Vera Ilic', role: 'Verification Admin', action: 'Requested seller information', object: 'st_kestrel', reason: 'Missing address and registration', before: 'Verification pending', after: 'More information required', approval: null, outcome: 'Success' },
  );
  db.seq.AU = 10;
  return db;
}

export function snapshotOf(listing, pkg, store) {
  return {
    listingId: listing.id, title: listing.title, sub: listing.sub, cat: listing.cat, unit: listing.unit,
    pkgId: pkg.id, pkgName: pkg.name, pkgDesc: pkg.desc, qty: pkg.qty, price: pkg.price, days: pkg.days,
    deliveryMethod: listing.deliveryMethod, replacement: listing.replacement, usage: listing.usage,
    storeName: store.name, art: listing.art, listingVersion: (listing.versions || []).length || 1,
  };
}
let evc = 0;
export function ev(at, actor, text, kind = 'info') { return { id: 'ev' + (++evc) + '_' + Math.round(at % 1e6), at, actor, text, kind }; }
export function round2(n) { return Math.round(n * 100) / 100; }
export function fmtN(n) { return Number(n).toLocaleString('en-US'); }
