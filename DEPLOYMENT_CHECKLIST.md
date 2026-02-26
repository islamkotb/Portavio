# ⚡ Quick Deployment Checklist

Use this alongside the full `DEPLOYMENT_GUIDE.md` as a reference.

---

## Pre-Deployment (30 min)

- [ ] Push code to GitHub
- [ ] Verify `backend/package.json` has all dependencies
- [ ] Create `.gitignore` (exclude `.env`, `node_modules/`)

---

## Database (15 min)

- [ ] Sign up: https://neon.tech
- [ ] Create project: `portavio-production`
- [ ] Copy connection string
- [ ] Run: `psql "CONNECTION_STRING" -f database/schema_multitenant.sql`
- [ ] Verify: `SELECT COUNT(*) FROM organizations;` returns 0

---

## Backend — Railway (30 min)

- [ ] Sign up: https://railway.app
- [ ] Deploy from GitHub: `portavio` repo
- [ ] Set root directory: `backend`
- [ ] Add environment variables:
  ```
  NODE_ENV=production
  PORT=3001
  DATABASE_URL=<from Neon>
  JWT_SECRET=<openssl rand -hex 32>
  ENCRYPTION_KEY=<openssl rand -hex 32>
  APP_URL=https://app.portavio.io
  CORS_ORIGIN=https://app.portavio.io
  ```
- [ ] Deploy
- [ ] Get Railway URL: `https://xxx.railway.app`
- [ ] Test: `curl https://xxx.railway.app/`
- [ ] (Optional) Add custom domain: `api.portavio.io`

---

## Redis — Upstash (10 min)

- [ ] Sign up: https://upstash.com
- [ ] Create database: `portavio-jobs`
- [ ] Copy Redis URL
- [ ] Add to Railway variables: `REDIS_URL=redis://...`
- [ ] Redeploy

---

## Frontend — Vercel (20 min)

- [ ] Update `frontend/index.html`:
  ```javascript
  const API_BASE = 'https://api.portavio.io';  // or Railway URL
  ```
- [ ] Commit & push
- [ ] Sign up: https://vercel.com
- [ ] Import repo, set root: `frontend`
- [ ] Deploy
- [ ] Get URL: `https://portavio.vercel.app`
- [ ] (Optional) Add custom domain: `app.portavio.io`
- [ ] Update Railway `CORS_ORIGIN` to match Vercel URL
- [ ] Test: Visit app, register user, connect Jira, sync

---

## Email — Resend (15 min)

- [ ] Sign up: https://resend.com
- [ ] Add domain: `portavio.io`
- [ ] Add DNS records (TXT, MX)
- [ ] Verify domain
- [ ] Create API key
- [ ] Add to Railway: `RESEND_API_KEY=re_xxx`
- [ ] Add to `package.json`: `"resend": "^3.0.0"`
- [ ] Redeploy

---

## Payments — Stripe (20 min)

- [ ] Sign up: https://stripe.com (stay in Test Mode)
- [ ] Create 3 products:
  - Starter: $49/month → copy Price ID
  - Pro: $149/month → copy Price ID
  - Enterprise: $499/month → copy Price ID
- [ ] Get API keys (Developers → API Keys)
- [ ] Create webhook: `https://api.portavio.io/api/billing/webhook`
- [ ] Add events: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`
- [ ] Copy webhook secret
- [ ] Add to Railway:
  ```
  STRIPE_SECRET_KEY=sk_test_xxx
  STRIPE_WEBHOOK_SECRET=whsec_xxx
  STRIPE_PRICE_STARTER=price_xxx
  STRIPE_PRICE_PRO=price_xxx
  STRIPE_PRICE_ENTERPRISE=price_xxx
  ```
- [ ] Add to `package.json`: `"stripe": "^14.10.0"`
- [ ] Redeploy

---

## Monitoring (20 min)

- [ ] Sign up: https://sentry.io
- [ ] Create Node.js project
- [ ] Copy DSN
- [ ] Add to Railway: `SENTRY_DSN=https://xxx`
- [ ] Add to `package.json`: `"@sentry/node": "^7.91.0"`
- [ ] Sign up: https://uptimerobot.com
- [ ] Add monitor for `https://api.portavio.io/`
- [ ] Set alert email

---

## Final Checks

- [ ] Register test user at `https://app.portavio.io`
- [ ] Connect Jira
- [ ] Sync data
- [ ] Invite second user (manually create invite in DB for now)
- [ ] Verify plan limits work (try 4th user on trial)
- [ ] Test Stripe checkout (use test card: 4242 4242 4242 4242)
- [ ] Check Railway logs: No errors
- [ ] Check Sentry: No critical errors
- [ ] Check UptimeRobot: Monitor green

---

## Go Live

- [ ] Switch Stripe to Live Mode
- [ ] Update Stripe keys in Railway (use `sk_live_xxx`)
- [ ] Add Terms of Service page
- [ ] Add Privacy Policy page
- [ ] Set up `support@portavio.io` email forwarding
- [ ] Post on Product Hunt
- [ ] Email your network

---

## URLs Reference

| Service | URL |
|---------|-----|
| Frontend | https://app.portavio.io |
| Backend | https://api.portavio.io |
| Neon Dashboard | https://console.neon.tech |
| Railway Dashboard | https://railway.app/dashboard |
| Vercel Dashboard | https://vercel.com/dashboard |
| Upstash Dashboard | https://console.upstash.com |
| Resend Dashboard | https://resend.com/emails |
| Stripe Dashboard | https://dashboard.stripe.com |
| Sentry Dashboard | https://sentry.io |
| UptimeRobot Dashboard | https://uptimerobot.com |

---

## Costs

| Service | Cost/Month |
|---------|------------|
| Neon | $0-19 |
| Railway | $5-20 |
| Upstash | $0-10 |
| Vercel | $0 |
| Resend | $0-20 |
| Stripe | 2.9% + 30¢/txn |
| Domain | $1 |
| **Total** | **$6-70** |

**Break-even: 1-2 customers**

---

## Emergency Contacts

| Issue | Where to Check |
|-------|---------------|
| Site down | Railway logs + UptimeRobot |
| Database issues | Neon dashboard → Compute status |
| Payment issues | Stripe dashboard → Events |
| Email not sending | Resend dashboard → Emails |
| Backend errors | Sentry dashboard → Issues |

---

**Full guide:** See `DEPLOYMENT_GUIDE.md` for detailed steps.
