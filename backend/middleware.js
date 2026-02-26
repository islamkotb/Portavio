// ============================================================================
// MULTI-TENANCY MIDDLEWARE & UTILITIES
// To be added to server.js or imported as a separate module
// ============================================================================

const crypto = require('crypto');

/**
 * MIDDLEWARE: Resolve organization from request
 * Checks that the authenticated user is a member of the requested org
 */
const requireOrg = async (req, res, next) => {
  try {
    // Get org slug from header (preferred) or URL param
    const orgSlug = req.headers['x-org-slug'] || req.params.orgSlug || req.query.orgSlug;
    
    if (!orgSlug) {
      return res.status(400).json({ error: 'Organization slug required' });
    }

    // Verify user is a member of this org
    const result = await pool.query(
      `SELECT o.*, om.role as user_role
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE o.slug = $1 AND om.user_id = $2`,
      [orgSlug, req.user.userId]
    );

    if (!result.rows.length) {
      return res.status(403).json({ error: 'Access denied to this organization' });
    }

    req.org = result.rows[0];
    req.userRole = result.rows[0].user_role;
    next();
  } catch (error) {
    console.error('requireOrg error:', error);
    res.status(500).json({ error: 'Organization resolution failed' });
  }
};

/**
 * MIDDLEWARE: Require specific role in org
 * Usage: requireRole('admin') or requireRole(['owner', 'admin'])
 */
const requireRole = (allowedRoles) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: req.userRole,
      });
    }
    next();
  };
};

/**
 * MIDDLEWARE: Check plan limits before allowing action
 * Usage: checkPlanLimit('users'), checkPlanLimit('projects')
 */
const checkPlanLimit = (resource) => async (req, res, next) => {
  try {
    const limits = {
      trial: {
        users: 3,
        projects: 5,
        syncsPerDay: 1,
      },
      starter: {
        users: 10,
        projects: 20,
        syncsPerDay: 24,
      },
      pro: {
        users: 50,
        projects: 999,
        syncsPerDay: 999,
      },
      enterprise: {
        users: 999,
        projects: 999,
        syncsPerDay: 999,
      },
    };

    const plan = req.org.plan;
    const limit = limits[plan]?.[resource];

    if (!limit) {
      return next(); // No limit defined for this resource/plan
    }

    // Check current usage
    let currentCount = 0;

    if (resource === 'users') {
      const result = await pool.query(
        'SELECT COUNT(*) FROM organization_members WHERE organization_id = $1',
        [req.org.id]
      );
      currentCount = parseInt(result.rows[0].count);
    }

    if (resource === 'projects') {
      const result = await pool.query(
        `SELECT COUNT(DISTINCT p.id) FROM projects p
         JOIN jira_connections jc ON p.jira_connection_id = jc.id
         WHERE jc.organization_id = $1`,
        [req.org.id]
      );
      currentCount = parseInt(result.rows[0].count);
    }

    if (resource === 'syncsPerDay') {
      const result = await pool.query(
        `SELECT COUNT(*) FROM jira_connections
         WHERE organization_id = $1
         AND last_sync > NOW() - INTERVAL '24 hours'`,
        [req.org.id]
      );
      currentCount = parseInt(result.rows[0].count);
    }

    if (currentCount >= limit) {
      return res.status(402).json({
        error: `${resource} limit reached`,
        limit,
        current: currentCount,
        plan,
        upgradeUrl: '/billing',
      });
    }

    next();
  } catch (error) {
    console.error('checkPlanLimit error:', error);
    res.status(500).json({ error: 'Plan limit check failed' });
  }
};

/**
 * UTILITY: Generate unique org slug from name
 */
function generateOrgSlug(name) {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  // Add random suffix to ensure uniqueness
  slug += '-' + crypto.randomBytes(3).toString('hex');
  return slug;
}

/**
 * UTILITY: Get or create default organization for user (migration helper)
 * Used when migrating from single-user to multi-tenant
 */
async function ensureUserHasOrg(userId) {
  // Check if user already belongs to an org
  const existing = await pool.query(
    `SELECT o.* FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.user_id = $1
     ORDER BY om.joined_at ASC
     LIMIT 1`,
    [userId]
  );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  // Create personal org for this user
  const user = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
  if (!user.rows.length) return null;

  const orgName = `${user.rows[0].name}'s Workspace`;
  const slug = generateOrgSlug(user.rows[0].email);

  const org = await pool.query(
    `INSERT INTO organizations (name, slug, plan, trial_ends_at)
     VALUES ($1, $2, 'trial', NOW() + INTERVAL '14 days')
     RETURNING *`,
    [orgName, slug]
  );

  // Add user as owner
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [org.rows[0].id, userId]
  );

  return org.rows[0];
}

/**
 * UTILITY: Create audit log entry
 */
async function logAudit(organizationId, userId, action, resourceType, resourceId, metadata = {}) {
  await pool.query(
    `INSERT INTO audit_log (organization_id, user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [organizationId, userId, action, resourceType, resourceId, JSON.stringify(metadata)]
  );
}

module.exports = {
  requireOrg,
  requireRole,
  checkPlanLimit,
  generateOrgSlug,
  ensureUserHasOrg,
  logAudit,
};
