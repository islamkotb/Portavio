# 🔄 Multi-Tenancy Migration Guide

This document explains how to integrate the multi-tenancy changes into your Portavio application.

## What Changed

**Before (Self-Hosted):**
- Each user has their own database
- Jira connections belong to individual users
- No concept of "organizations"

**After (SaaS Multi-Tenant):**
- One shared database with all customers' data
- Organizations are the top-level entity
- Users belong to organizations
- Jira connections belong to organizations
- All data is scoped by organization_id

---

## Step 1: Run Database Migrations

```bash
# 1. Backup your existing database first!
pg_dump portavio > backup_before_multitenant.sql

# 2. Run the SaaS migration
psql portavio < database/saas_migration.sql

# This adds:
# - organizations table
# - organization_members table
# - invitations table
# - billing_events table
# - audit_log table
# - email_log table
# - usage_events table
# - Updates views to include organization_id
```

**What this does:**
- Adds all new tables for organizations, members, invitations, billing
- Adds columns to users table (email_verified, last_login_at, etc.)
- Updates database views to include organization_id for filtering
- Does NOT yet migrate existing user data (that's Step 2)

---

## Step 2: Migrate Existing Users to Organizations

If you have existing users in the database (from testing self-hosted), run this migration:

```sql
-- Create an organization for each existing user
INSERT INTO organizations (name, slug, plan, trial_ends_at, max_users, max_projects, sync_frequency_minutes)
SELECT
    CONCAT(name, '''s Workspace'),
    LOWER(REGEXP_REPLACE(email, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(md5(random()::text), 1, 6),
    'trial',
    NOW() + INTERVAL '14 days',
    3,
    5,
    1440
FROM users;

-- Add each user as owner of their organization
INSERT INTO organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM users u
JOIN organizations o ON o.name = CONCAT(u.name, '''s Workspace')
WHERE NOT EXISTS (
    SELECT 1 FROM organization_members om 
    WHERE om.user_id = u.id AND om.organization_id = o.id
);

-- Migrate jira_connections to be owned by organizations
UPDATE jira_connections jc
SET organization_id = (
    SELECT om.organization_id
    FROM organization_members om
    WHERE om.user_id = jc.user_id AND om.role = 'owner'
    LIMIT 1
)
WHERE organization_id IS NULL;

-- Optional: Drop the old user_id column from jira_connections
-- (Only do this after verifying everything works!)
-- ALTER TABLE jira_connections DROP COLUMN user_id;
```

---

## Step 3: Update server.js

Replace the relevant sections in `backend/server.js` with the new multi-tenant versions:

### 3a. Add imports at the top

```javascript
const crypto = require('crypto');

// Import multi-tenancy middleware (add after other requires)
const {
  requireOrg,
  requireRole,
  checkPlanLimit,
  generateOrgSlug,
  ensureUserHasOrg,
  logAudit,
} = require('./middleware');
```

### 3b. Replace AUTH routes (lines 641-673)

Copy the entire content from `backend/routes-auth.js` into `server.js`, replacing:
- `app.post('/api/auth/register', ...)`
- `app.post('/api/auth/login', ...)`
- `app.get('/api/auth/profile', ...)`

And ADD the new organization routes:
- `app.get('/api/org/:orgSlug', ...)`
- `app.patch('/api/org/:orgSlug', ...)`
- `app.get('/api/org/:orgSlug/members', ...)`
- `app.post('/api/org/:orgSlug/invite', ...)`
- `app.delete('/api/org/:orgSlug/members/:userId', ...)`

### 3c. Replace JIRA routes (lines 678-720)

Copy the entire content from `backend/routes-jira.js` into `server.js`, replacing:
- `app.post('/api/jira/connect', ...)`
- `app.get('/api/jira/status', ...)`
- `app.post('/api/jira/sync', ...)`

And ADD:
- `app.delete('/api/jira/disconnect', ...)`

### 3d. Replace DASHBOARD routes (lines 724+)

Copy the entire content from `backend/routes-dashboard.js` into `server.js`, replacing all dashboard endpoints.

**Key change:** All queries now join through `jira_connections.organization_id` instead of `user_id`.

---

## Step 4: Update Frontend

The frontend needs to handle organizations. Here are the key changes:

### 4a. Update API calls to include org slug

```javascript
// Before:
const data = await api('/api/dashboard/projects');

// After:
const currentOrg = localStorage.getItem('pv_current_org') || orgs[0].slug;
const data = await api('/api/dashboard/projects', 'GET', null, currentOrg);

// Update the api() helper:
async function api(path, method = 'GET', body = null, orgSlug = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (orgSlug) headers['X-Org-Slug'] = orgSlug;  // <-- Add this
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
```

### 4b. Add organization selector

After login, the API returns a list of organizations the user belongs to. Show a dropdown:

```javascript
// After successful login:
const { organizations } = await api('/api/auth/profile');

if (organizations.length > 1) {
  // Show org selector dropdown
  showOrgSelector(organizations);
} else {
  // Auto-select the only org
  localStorage.setItem('pv_current_org', organizations[0].slug);
}
```

### 4c. Update registration flow

```javascript
// When registering via invite:
const urlParams = new URLSearchParams(window.location.search);
const inviteToken = urlParams.get('invite');

await api('/api/auth/register', 'POST', {
  name,
  email,
  password,
  inviteToken,  // <-- Pass invite token if present
});
```

---

## Step 5: Test the Migration

### Test 1: New User Registration
1. Clear localStorage
2. Register a new user
3. Verify they get a personal organization created
4. Check database: `SELECT * FROM organizations ORDER BY created_at DESC LIMIT 1;`
5. Verify they can connect Jira and sync

### Test 2: Team Invitations
1. As user A (owner), invite user B
2. Check email logs: `SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 1;`
3. Copy invite token from database: `SELECT token FROM invitations ORDER BY created_at DESC LIMIT 1;`
4. Register user B with invite link: `/accept-invite?token=<TOKEN>`
5. User B should join user A's org
6. Both users should see same Jira data

### Test 3: Organization Isolation
1. Create 2 separate orgs (2 different users)
2. Connect different Jira instances to each
3. Sync both
4. Verify org A cannot see org B's data:
   ```sql
   SELECT COUNT(*) FROM projects p
   JOIN jira_connections jc ON p.jira_connection_id = jc.id
   WHERE jc.organization_id = 1;  -- Should match org A's project count only
   ```

### Test 4: Plan Limits
1. Create a trial org (default)
2. Try to invite 4th user → should fail with 402 error
3. Manually upgrade org to 'starter' in database
4. Try to invite 4th user again → should succeed

---

## Step 6: Update package.json

Add crypto dependency (though it's built-in to Node.js, this documents it):

```json
{
  "dependencies": {
    "crypto": "latest"
  }
}
```

---

## Troubleshooting

### Error: "Organization slug required"

**Cause:** Frontend not sending `X-Org-Slug` header.

**Fix:** Update your `api()` helper to include the header (see Step 4a).

---

### Error: "Access denied to this organization"

**Cause:** User is not a member of the org they're trying to access.

**Fix:** Check `organization_members` table:
```sql
SELECT * FROM organization_members WHERE user_id = <USER_ID>;
```

---

### Error: "No active Jira connection"

**Cause:** `jira_connections.organization_id` is NULL.

**Fix:** Run the data migration (Step 2) to populate organization_id.

---

### Users can't see their old data after migration

**Cause:** Data wasn't properly migrated to organizations.

**Fix:**
```sql
-- Check if jira_connections have organization_id:
SELECT id, user_id, organization_id FROM jira_connections;

-- If organization_id is NULL, run Step 2 migration
```

---

## Rollback Plan

If something goes wrong, you can roll back:

```bash
# 1. Restore from backup
pg_restore -d portavio backup_before_multitenant.sql

# 2. Revert code changes
git checkout HEAD~1 backend/server.js
```

---

## Summary Checklist

- [ ] Backup database
- [ ] Run `saas_migration.sql`
- [ ] Run data migration (Step 2)
- [ ] Update `server.js` with new routes
- [ ] Copy `middleware.js` into backend folder
- [ ] Update frontend `api()` helper
- [ ] Add org selector to frontend
- [ ] Test new user registration
- [ ] Test team invitations
- [ ] Test data isolation between orgs
- [ ] Test plan limits
- [ ] Commit changes to Git

Once all boxes are checked, you have successfully migrated to multi-tenancy! 🎉
