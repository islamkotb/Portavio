// ============================================================================
// ADMIN API ROUTES
// Add these to backend/server.js
// ============================================================================

// Middleware: Check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    const user = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.user.userId]
    );
    
    if (!user.rows.length || user.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

// ===========================================================================
// ADMIN: Dashboard Stats
// ===========================================================================

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM organizations WHERE subscription_status IN ('active', 'trialing')) as active_subscriptions,
        (SELECT 
          SUM(CASE 
            WHEN plan = 'starter' THEN 49
            WHEN plan = 'pro' THEN 149
            WHEN plan = 'enterprise' THEN 499
            ELSE 0
          END)
          FROM organizations 
          WHERE subscription_status = 'active'
        ) as mrr,
        (SELECT 
          ROUND(
            (COUNT(*) FILTER (WHERE plan != 'trial')::decimal / 
            NULLIF(COUNT(*), 0)) * 100, 
            1
          )
          FROM organizations
        ) as conversion_rate
    `);

    res.json({
      totalUsers: parseInt(stats.rows[0].total_users),
      activeSubscriptions: parseInt(stats.rows[0].active_subscriptions),
      mrr: parseInt(stats.rows[0].mrr || 0),
      conversionRate: parseFloat(stats.rows[0].conversion_rate || 0),
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ===========================================================================
// ADMIN: Recent Signups
// ===========================================================================

app.get('/api/admin/recent-signups', authenticateToken, requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  
  try {
    const signups = await pool.query(`
      SELECT 
        u.id,
        u.name as user_name,
        u.email as user_email,
        o.name as org_name,
        o.plan,
        u.created_at
      FROM users u
      JOIN organization_members om ON om.user_id = u.id
      JOIN organizations o ON o.id = om.organization_id
      ORDER BY u.created_at DESC
      LIMIT $1
    `, [limit]);

    res.json(signups.rows);
  } catch (error) {
    console.error('Recent signups error:', error);
    res.status(500).json({ error: 'Failed to fetch signups' });
  }
});

// ===========================================================================
// ADMIN: All Organizations
// ===========================================================================

app.get('/api/admin/organizations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgs = await pool.query(`
      SELECT 
        o.*,
        COUNT(DISTINCT om.user_id) as member_count
      FROM organizations o
      LEFT JOIN organization_members om ON om.organization_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);

    res.json(orgs.rows);
  } catch (error) {
    console.error('Organizations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// ===========================================================================
// ADMIN: Organization Details
// ===========================================================================

app.get('/api/admin/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const org = await pool.query(`
      SELECT 
        o.*,
        COUNT(DISTINCT om.user_id) as member_count,
        COUNT(DISTINCT p.id) as project_count
      FROM organizations o
      LEFT JOIN organization_members om ON om.organization_id = o.id
      LEFT JOIN jira_connections jc ON jc.organization_id = o.id
      LEFT JOIN projects p ON p.jira_connection_id = jc.id
      WHERE o.id = $1
      GROUP BY o.id
    `, [id]);

    if (!org.rows.length) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(org.rows[0]);
  } catch (error) {
    console.error('Organization detail error:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// ===========================================================================
// ADMIN: Update Organization Subscription
// ===========================================================================

app.patch('/api/admin/organizations/:id/subscription', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { subscription_status, plan } = req.body;
  
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (subscription_status) {
      updates.push(`subscription_status = $${paramIndex++}`);
      values.push(subscription_status);
    }

    if (plan) {
      updates.push(`plan = $${paramIndex++}`);
      values.push(plan);
      
      // Update limits based on plan
      const limits = {
        trial:      { max_users: 3,   max_projects: 5,   sync_frequency: 1440 },
        starter:    { max_users: 10,  max_projects: 20,  sync_frequency: 60 },
        pro:        { max_users: 50,  max_projects: 999, sync_frequency: 15 },
        enterprise: { max_users: 999, max_projects: 999, sync_frequency: 5 },
      };
      
      if (limits[plan]) {
        updates.push(`max_users = $${paramIndex++}`);
        values.push(limits[plan].max_users);
        updates.push(`max_projects = $${paramIndex++}`);
        values.push(limits[plan].max_projects);
        updates.push(`sync_frequency_minutes = $${paramIndex++}`);
        values.push(limits[plan].sync_frequency);
      }
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(`
      UPDATE organizations
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    // Log the change
    await pool.query(`
      INSERT INTO audit_log (organization_id, user_id, action, resource_type, resource_id, metadata)
      VALUES ($1, $2, 'admin.subscription_updated', 'organization', $3, $4)
    `, [
      id,
      req.user.userId,
      id,
      JSON.stringify({ subscription_status, plan }),
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Subscription update error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// ===========================================================================
// ADMIN: All Users
// ===========================================================================

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        u.last_login_at,
        o.name as org_name,
        om.role as org_role
      FROM users u
      LEFT JOIN organization_members om ON om.user_id = u.id
      LEFT JOIN organizations o ON o.id = om.organization_id
      ORDER BY u.created_at DESC
    `);

    res.json(users.rows);
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ===========================================================================
// ADMIN: User Details
// ===========================================================================

app.get('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const user = await pool.query(`
      SELECT 
        u.*,
        json_agg(
          json_build_object(
            'org_id', o.id,
            'org_name', o.name,
            'role', om.role,
            'joined_at', om.joined_at
          )
        ) FILTER (WHERE o.id IS NOT NULL) as organizations
      FROM users u
      LEFT JOIN organization_members om ON om.user_id = u.id
      LEFT JOIN organizations o ON o.id = om.organization_id
      WHERE u.id = $1
      GROUP BY u.id
    `, [id]);

    if (!user.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user.rows[0]);
  } catch (error) {
    console.error('User detail error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ===========================================================================
// ADMIN: All Subscriptions
// ===========================================================================

app.get('/api/admin/subscriptions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const subs = await pool.query(`
      SELECT 
        o.id,
        o.name as org_name,
        o.plan,
        o.subscription_status,
        o.stripe_customer_id,
        o.stripe_subscription_id,
        o.trial_ends_at,
        o.created_at
      FROM organizations o
      ORDER BY 
        CASE o.subscription_status
          WHEN 'active' THEN 1
          WHEN 'trialing' THEN 2
          WHEN 'past_due' THEN 3
          ELSE 4
        END,
        o.created_at DESC
    `);

    res.json(subs.rows);
  } catch (error) {
    console.error('Subscriptions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// ===========================================================================
// ADMIN: Make User Admin
// ===========================================================================

app.patch('/api/admin/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  
  try {
    const result = await pool.query(`
      UPDATE users
      SET role = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email, role
    `, [role, id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log the change
    await pool.query(`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, metadata)
      VALUES ($1, 'admin.role_changed', 'user', $2, $3)
    `, [
      req.user.userId,
      id,
      JSON.stringify({ new_role: role }),
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

module.exports = {
  requireAdmin,
};
