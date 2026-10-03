import 'dotenv/config';

const env = process.env;
const production = env.NODE_ENV === 'production';
const bool = (v, d) => v == null || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase());

export const config = {
  production,
  port: Number(env.PORT) || 4000,
  databaseUrl: env.DATABASE_URL || '',
  jwtSecret: env.JWT_SECRET || (production ? '' : 'dev-only-secret'),
  jwtTtl: '12h',
  origins: (env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean),
  seedPassword: env.SEED_DEMO_PASSWORD || (production ? '' : 'demo-password-change-me'),
  simulateProviders: bool(env.SIMULATE_PROVIDERS, !production),
  allowDemoControls: bool(env.ALLOW_DEMO_CONTROLS, !production),
  // Sign-in and registration attempts per IP address per 15 minutes.
  authRateLimit: Number(env.AUTH_RATE_LIMIT) || 30,
  // Transactional email. With BREVO_API_KEY set, email is sent through Brevo. Without it, outside
  // production, emails are written to the server log ('log') so the flows can be tried locally;
  // in production without a key, email features stay off ('off').
  brevoApiKey: env.BREVO_API_KEY || '',
  emailFrom: env.EMAIL_FROM || '',
  emailFromName: env.EMAIL_FROM_NAME || 'Crateline',
  // Address of the website, used for links in emails (verification, password reset).
  appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
};
config.emailTransport = env.EMAIL_TRANSPORT || (config.brevoApiKey ? 'brevo' : production ? 'off' : 'log');

export function assertConfig() {
  const missing = [];
  if (!config.jwtSecret) missing.push('JWT_SECRET');
  if (config.production && !config.databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));
  if (config.production && config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production.');
  if (config.emailTransport === 'brevo' && (!config.brevoApiKey || !/^\S+@\S+\.\S+$/.test(config.emailFrom))) throw new Error('Brevo email needs BREVO_API_KEY and EMAIL_FROM (a sender address verified in Brevo).');
}
