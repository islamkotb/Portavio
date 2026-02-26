# 🚀 Fresh Start — Multi-Tenant Setup (No Migration Needed)

Since you haven't used the application yet, you can start directly with the multi-tenant version. No migration needed!

---

## Option 1: Quick Start (Recommended)

Use the combined schema that has everything built-in:

```bash
# 1. Create database
createdb portavio

# 2. Run the multi-tenant schema (includes everything)
psql portavio < database/schema_multitenant.sql

# Done! Your database now has all base tables + multi-tenancy tables
```

---

## Option 2: Step-by-Step

If you prefer to see what's happening:

```bash
# 1. Create database
createdb portavio

# 2. Run base schema (projects, teams, epics, etc.)
psql portavio < database/schema.sql

# 3. Add multi-tenancy layer (organizations, members, etc.)
psql portavio < database/saas_migration.sql

# Done!
```

---

## Update server.js

Now integrate the multi-tenant code into your backend:

### 1. Copy the middleware file

The file `backend/middleware.js` is already in your package. Make sure it's in your backend folder.

### 2. Update server.js

Add this near the top of `backend/server.js` (after the other requires):

```javascript
const crypto = require('crypto');

// Multi-tenancy middleware
const {
  requireOrg,
  requireRole,
  checkPlanLimit,
  generateOrgSlug,
  logAudit,
} = require('./middleware');
```

### 3. Replace the auth routes

Find these routes in `server.js`:
- `app.post('/api/auth/register', ...)`
- `app.post('/api/auth/login', ...)`
- `app.get('/api/auth/profile', ...)`

Replace them with the code from `backend/routes-auth.js`.

**Also ADD** these new routes (they don't exist yet):
- `app.get('/api/org/:orgSlug', ...)`
- `app.patch('/api/org/:orgSlug', ...)`
- `app.get('/api/org/:orgSlug/members', ...)`
- `app.post('/api/org/:orgSlug/invite', ...)`
- `app.delete('/api/org/:orgSlug/members/:userId', ...)`

All the code is in `backend/routes-auth.js` — just copy/paste it into `server.js`.

### 4. Replace the Jira routes

Find these routes:
- `app.post('/api/jira/connect', ...)`
- `app.get('/api/jira/status', ...)`
- `app.post('/api/jira/sync', ...)`

Replace them with the code from `backend/routes-jira.js`.

### 5. Replace the dashboard routes

Find all routes starting with `/api/dashboard/*` and replace them with the code from `backend/routes-dashboard.js`.

The key change: queries now filter by `organization_id` instead of `user_id`.

---

## Update Frontend

The frontend needs to send the organization slug with every API request.

### Update the api() helper function

Find this function in `frontend/index.html`:

```javascript
async function api(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
```

**Replace it with:**

```javascript
async function api(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  // Add organization slug header
  const currentOrg = localStorage.getItem('pv_current_org');
  if (currentOrg) headers['X-Org-Slug'] = currentOrg;
  
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
```

### Update login/registration to save org slug

After successful login, save the org slug:

```javascript
async function login() {
  // ... existing code ...
  const data = await api('/api/auth/login', 'POST', { email, password });
  token = data.token;
  userName = data.user.name;
  localStorage.setItem('pv_token', token);
  localStorage.setItem('pv_user', userName);
  
  // NEW: Save the first org as current org
  if (data.organizations && data.organizations.length > 0) {
    localStorage.setItem('pv_current_org', data.organizations[0].slug);
  }
  
  showApp();
}

async function register() {
  // ... existing code ...
  const data = await api('/api/auth/register', 'POST', { name, email, password });
  token = data.token;
  userName = data.user.name;
  localStorage.setItem('pv_token', token);
  localStorage.setItem('pv_user', userName);
  
  // NEW: Save the org slug
  if (data.organization) {
    localStorage.setItem('pv_current_org', data.organization.slug);
  }
  
  showApp();
}
```

---

## Test It

### Test 1: First User Registration

1. Start the backend: `node backend/server.js`
2. Open `http://localhost:3000` in browser
3. Register a new user (email: test@test.com, password: test1234, name: Test User)
4. **Expected result:**
   - User is created
   - Personal organization is created automatically (e.g., "Test User's Workspace")
   - User is added as owner of that org
   - Login succeeds

**Verify in database:**
```sql
-- Check user was created
SELECT * FROM users WHERE email = 'test@test.com';

-- Check org was created
SELECT * FROM organizations ORDER BY created_at DESC LIMIT 1;

-- Check user is a member
SELECT * FROM organization_members ORDER BY joined_at DESC LIMIT 1;
```

### Test 2: Connect Jira

1. After logging in, click "Connect Jira"
2. Enter Jira URL, email, API token
3. Click "Connect"
4. **Expected result:**
   - Connection saved at organization level (not user level)
   - `jira_connections.organization_id` is populated

**Verify in database:**
```sql
SELECT jc.*, o.name as org_name 
FROM jira_connections jc
JOIN organizations o ON jc.organization_id = o.id;
```

### Test 3: Sync Data

1. Click "Sync Jira"
2. Wait for sync to complete
3. **Expected result:**
   - Projects, teams, epics appear on dashboard
   - Data is scoped to your organization

**Verify in database:**
```sql
-- Should only see data for your organization
SELECT p.name, o.name as org_name
FROM projects p
JOIN jira_connections jc ON p.jira_connection_id = jc.id
JOIN organizations o ON jc.organization_id = o.id;
```

### Test 4: Invite a Team Member (Optional)

1. Register a second user in an incognito window
2. As first user, go to Settings (you'll need to add this UI)
3. Invite the second user by email
4. Second user should join the same org
5. Both users should see the same Jira data

---

## What You Get

With this setup, you have:

✅ **Multi-tenancy** — Multiple organizations in one database  
✅ **Team collaboration** — Multiple users per organization  
✅ **Data isolation** — Org A cannot see Org B's data  
✅ **Role-based access** — Owner, admin, member, viewer  
✅ **Plan limits** — Trial (3 users, 5 projects), Starter (10 users, 20 projects), etc.  
✅ **Ready for billing** — Organizations table has stripe_customer_id, subscription_status columns  

---

## Next Steps

Once multi-tenancy works, you can add:

1. **Stripe billing** — Hook up checkout, webhooks, plan enforcement (2 days)
2. **Email** — Welcome emails, invite emails (1 day)
3. **Automatic sync** — Background job queue with Bull + Redis (2 days)
4. **Team settings page** — UI to manage members, invites, billing (2 days)

But get multi-tenancy working first. It's the foundation.

---

## Troubleshooting

### "Organization slug required"
**Fix:** Make sure the frontend is sending the `X-Org-Slug` header. Check that `localStorage.getItem('pv_current_org')` returns a value.

### "Access denied to this organization"
**Fix:** The user is not a member of the org they're trying to access. Check:
```sql
SELECT * FROM organization_members WHERE user_id = <YOUR_USER_ID>;
```

### Jira connection fails with "No active connection"
**Fix:** Check that `jira_connections.organization_id` is set:
```sql
SELECT * FROM jira_connections;
```

### Can't see any data after sync
**Fix:** Check that data exists and is linked to your org:
```sql
SELECT COUNT(*), o.name
FROM projects p
JOIN jira_connections jc ON p.jira_connection_id = jc.id
JOIN organizations o ON jc.organization_id = o.id
GROUP BY o.name;
```

---

## Quick Reference: File Structure

```
portavio/
├── backend/
│   ├── server.js              ← Update this (copy routes from new files)
│   ├── middleware.js          ← NEW: Multi-tenancy middleware
│   ├── routes-auth.js         ← NEW: Reference for auth routes
│   ├── routes-jira.js         ← NEW: Reference for Jira routes
│   └── routes-dashboard.js    ← NEW: Reference for dashboard routes
├── database/
│   ├── schema.sql             ← Base schema
│   ├── saas_migration.sql     ← Multi-tenancy additions
│   └── schema_multitenant.sql ← Combined (use this!)
└── frontend/
    └── index.html             ← Update api() helper function
```

---

## Summary

Since you're starting fresh:

1. Run `schema_multitenant.sql` to create database with multi-tenancy built-in
2. Update `server.js` with the new multi-tenant routes
3. Update `frontend/index.html` to send org slug header
4. Test: register user → connect Jira → sync → see data
5. Done! No migration needed. 🎉
