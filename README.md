# 🎯 Portavio

**Your Jira portfolio, finally visible.**

Portavio gives engineering leaders real-time visibility across their Jira portfolio. Track risks, blockers, team velocity, and epic dependencies in one place.

---

## 📚 Documentation Index

**Start here based on what you need:**

### 🚀 I want to deploy this as a live SaaS product
1. **[FRESH_START_MULTITENANT.md](FRESH_START_MULTITENANT.md)** — Set up multi-tenancy (1 hour)
2. **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** — Deploy to production (2-4 hours)
3. **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** — Quick reference

### 🏗️ I want to build this into a complete SaaS business
1. **[SAAS_TRANSFORMATION.md](SAAS_TRANSFORMATION.md)** — What needs to change
2. **[100_PERCENT_CHECKLIST.md](100_PERCENT_CHECKLIST.md)** — Feature roadmap to 100%
3. **[FRESH_START_MULTITENANT.md](FRESH_START_MULTITENANT.md)** — Multi-tenancy setup

### 🔧 I'm already using the self-hosted version
1. **[MULTITENANT_MIGRATION.md](MULTITENANT_MIGRATION.md)** — Migrate existing data
2. **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** — Deploy to cloud

### 📖 I want to understand how it works
1. **[DATA_MODEL_EXPLAINED.md](DATA_MODEL_EXPLAINED.md)** — Database architecture
2. **[SYNC_EXPLAINED.md](SYNC_EXPLAINED.md)** — How Jira sync works
3. **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)** — Code organization

---

## ⚡ Quick Start (Local Development)

```bash
# 1. Set up database
createdb portavio
psql portavio < database/schema_multitenant.sql

# 2. Configure backend
cd backend
cp .env.example .env
# Edit .env with your values
npm install

# 3. Start backend
node server.js

# 4. Open frontend
open frontend/index.html
# Or serve with: python3 -m http.server 3000
```

**First time setup:**
1. Register at http://localhost:3000
2. Connect your Jira (URL, email, API token from https://id.atlassian.com/manage-profile/security/api-tokens)
3. Click "Sync Jira"
4. See your portfolio dashboard

---

## 🌟 Key Features

- **Auto-detect risks & blockers** — No manual tagging required
- **Team ↔ Project ↔ Epic mapping** — Explicit ownership relationships
- **Velocity trends** — Track team performance over time
- **Predictability scores** — Identify reliable vs. unpredictable teams
- **Cross-project dependencies** — Visual dependency graph
- **Multi-tenancy** — Team collaboration with role-based access
- **Plan limits** — Trial/Starter/Pro/Enterprise tiers built-in
- **Billing-ready** — Stripe integration included

---

## 📊 Tech Stack

**Frontend:** Pure HTML/CSS/JS (no framework needed)  
**Backend:** Node.js + Express  
**Database:** PostgreSQL  
**Queue:** Redis + Bull  
**Email:** Resend  
**Payments:** Stripe  

---

## 🚀 Production Deployment

**Recommended stack:**
- Frontend: Vercel (free)
- Backend: Railway ($5-20/month)
- Database: Neon ($0-19/month)
- Redis: Upstash ($0-10/month)

**Total cost: $5-50/month**  
**Break-even: 1-2 paying customers at $49/month**

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for complete step-by-step instructions.

---

## 📁 Project Structure

```
portavio/
├── backend/
│   ├── server.js              # Main API server
│   ├── middleware.js          # Multi-tenancy middleware
│   ├── routes-auth.js         # Auth routes (reference)
│   ├── routes-jira.js         # Jira routes (reference)
│   └── routes-dashboard.js    # Dashboard routes (reference)
├── frontend/
│   └── index.html             # Complete SPA
├── database/
│   ├── schema.sql             # Base schema
│   ├── saas_migration.sql     # Multi-tenancy additions
│   └── schema_multitenant.sql # Combined (use this!)
└── docs/
    └── [All markdown files]
```

---

## 🎯 Roadmap to Production

### Phase 1: Multi-Tenancy (Week 1)
- [x] Organizations table
- [x] Organization members
- [x] Team invitations
- [x] Role-based access
- [x] Plan limits

### Phase 2: SaaS Features (Week 2-3)
- [ ] Stripe billing integration
- [ ] Email templates (welcome, invite, trial ending)
- [ ] Automatic background sync
- [ ] Org settings page

### Phase 3: Growth (Week 4-6)
- [ ] Atlassian Marketplace listing
- [ ] Google OAuth
- [ ] SSO (enterprise)
- [ ] Data export

### Phase 4: Scale (Week 7+)
- [ ] Usage analytics
- [ ] A/B testing
- [ ] Customer support chat
- [ ] Help documentation

See [100_PERCENT_CHECKLIST.md](100_PERCENT_CHECKLIST.md) for complete roadmap.

---

## 💰 Business Model

| Plan | Price/Month | Users | Projects | Sync Frequency |
|------|-------------|-------|----------|----------------|
| Trial | Free (14 days) | 3 | 5 | Daily |
| Starter | $49 | 10 | 20 | Hourly |
| Pro | $149 | 50 | Unlimited | 15 minutes |
| Enterprise | $499 | Unlimited | Unlimited | 5 minutes + SSO |

**Target market:** 5-300 person engineering teams  
**Revenue goal:** $10K MRR by month 12 (100 customers)  
**Customer acquisition:** Atlassian Marketplace, SEO, LinkedIn outreach

---

## 🤝 Support

- **Documentation:** See docs folder
- **Issues:** GitHub Issues (if you make it public)
- **Email:** support@portavio.io (set this up when live)

---

## 📜 License

Copyright 2025 Portavio  
Proprietary - Not for redistribution

---

## 🚀 Get Started

Choose your path:

**Want to deploy it live?**  
→ [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

**Want to understand it first?**  
→ [DATA_MODEL_EXPLAINED.md](DATA_MODEL_EXPLAINED.md)

**Want to build the full SaaS?**  
→ [100_PERCENT_CHECKLIST.md](100_PERCENT_CHECKLIST.md)

**Ready to code?**  
→ [FRESH_START_MULTITENANT.md](FRESH_START_MULTITENANT.md)
