// ============================================================================
// AUTH ROUTES - MULTI-TENANT VERSION
// Replace the auth section in server.js with this
// ============================================================================

// Registration: Creates user + personal organization
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, inviteToken } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create user
    const hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, email_verified)
       VALUES ($1, $2, $3, false)
       RETURNING id, email, name`,
      [email, hash, name]
    );
    const user = userResult.rows[0];

    let organization;

    // If registering via invite, join that org
    if (inviteToken) {
      const invite = await pool.query(
        `SELECT * FROM invitations
         WHERE token = $1
         AND email = $2
         AND expires_at > NOW()
         AND accepted_at IS NULL`,
        [inviteToken, email]
      );

      if (invite.rows.length) {
        const inv = invite.rows[0];
        
        // Add user to org
        await pool.query(
          `INSERT INTO organization_members (organization_id, user_id, role, invited_by)
           VALUES ($1, $2, $3, $4)`,
          [inv.organization_id, user.id, inv.role, inv.invited_by]
        );

        // Mark invite as accepted
        await pool.query(
          'UPDATE invitations SET accepted_at = NOW() WHERE id = $1',
          [inv.id]
        );

        // Get org details
        const orgResult = await pool.query(
          'SELECT * FROM organizations WHERE id = $1',
          [inv.organization_id]
        );
        organization = orgResult.rows[0];

        await logAudit(organization.id, user.id, 'member.joined', 'organization', organization.id, { via: 'invite' });
      }
    }

    // If no invite, create personal org
    if (!organization) {
      const orgName = `${name}'s Workspace`;
      const slug = generateOrgSlug(email);

      const orgResult = await pool.query(
        `INSERT INTO organizations (name, slug, plan, trial_ends_at, max_users, max_projects, sync_frequency_minutes)
         VALUES ($1, $2, 'trial', NOW() + INTERVAL '14 days', 3, 5, 1440)
         RETURNING *`,
        [orgName, slug]
      );
      organization = orgResult.rows[0];

      // Add user as owner
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [organization.id, user.id]
      );

      await logAudit(organization.id, user.id, 'organization.created', 'organization', organization.id);
    }

    const token = generateToken(user.id, user.email);

    res.status(201).json({
      message: 'Registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login: Returns user + their organizations
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, email, name, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    if (!userResult.rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user's organizations
    const orgsResult = await pool.query(
      `SELECT o.id, o.name, o.slug, o.plan, o.subscription_status, om.role
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.joined_at ASC`,
      [user.id]
    );

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    const token = generateToken(user.id, user.email);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      organizations: orgsResult.rows,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Profile: Returns user info + organizations
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, email, name, role, created_at, last_login_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    const orgsResult = await pool.query(
      `SELECT o.id, o.name, o.slug, o.plan, o.subscription_status, om.role
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.joined_at ASC`,
      [req.user.userId]
    );

    res.json({
      user: userResult.rows[0],
      organizations: orgsResult.rows,
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Profile fetch failed' });
  }
});

// ============================================================================
// ORGANIZATION ROUTES
// ============================================================================

// Get organization details
app.get('/api/org/:orgSlug', authenticateToken, requireOrg, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM organization_members WHERE organization_id = $1) as member_count,
        (SELECT COUNT(DISTINCT p.id) FROM projects p 
         JOIN jira_connections jc ON p.jira_connection_id = jc.id 
         WHERE jc.organization_id = $1) as project_count`,
      [req.org.id]
    );

    res.json({
      organization: req.org,
      stats: stats.rows[0],
      userRole: req.userRole,
    });
  } catch (error) {
    console.error('Org fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// Update organization settings
app.patch('/api/org/:orgSlug', authenticateToken, requireOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { name, logo_url } = req.body;

  try {
    const updated = await pool.query(
      `UPDATE organizations
       SET name = COALESCE($1, name),
           logo_url = COALESCE($2, logo_url),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name, logo_url, req.org.id]
    );

    await logAudit(req.org.id, req.user.userId, 'organization.updated', 'organization', req.org.id, { name, logo_url });

    res.json({ organization: updated.rows[0] });
  } catch (error) {
    console.error('Org update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

// List organization members
app.get('/api/org/:orgSlug/members', authenticateToken, requireOrg, async (req, res) => {
  try {
    const members = await pool.query(
      `SELECT u.id, u.email, u.name, om.role, om.joined_at
       FROM users u
       JOIN organization_members om ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY om.joined_at ASC`,
      [req.org.id]
    );

    res.json({ members: members.rows });
  } catch (error) {
    console.error('Members fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Invite team member
app.post('/api/org/:orgSlug/invite', authenticateToken, requireOrg, requireRole(['owner', 'admin']), checkPlanLimit('users'), async (req, res) => {
  const { email, role = 'member' } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    // Check if user already member
    const existing = await pool.query(
      `SELECT u.id FROM users u
       JOIN organization_members om ON om.user_id = u.id
       WHERE om.organization_id = $1 AND u.email = $2`,
      [req.org.id, email]
    );

    if (existing.rows.length) {
      return res.status(400).json({ error: 'User already a member' });
    }

    // Check for existing pending invite
    const pendingInvite = await pool.query(
      `SELECT id FROM invitations
       WHERE organization_id = $1 AND email = $2 AND expires_at > NOW() AND accepted_at IS NULL`,
      [req.org.id, email]
    );

    if (pendingInvite.rows.length) {
      return res.status(400).json({ error: 'Invitation already sent' });
    }

    // Create invitation
    const token = crypto.randomBytes(32).toString('hex');
    const invite = await pool.query(
      `INSERT INTO invitations (organization_id, email, token, role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
       RETURNING *`,
      [req.org.id, email, token, role, req.user.userId]
    );

    // TODO: Send invitation email via SendGrid/Resend
    const inviteLink = `${process.env.APP_URL}/accept-invite/${token}`;
    console.log(`[INVITE] Send email to ${email}: ${inviteLink}`);

    await logAudit(req.org.id, req.user.userId, 'member.invited', 'invitation', invite.rows[0].id, { email, role });

    res.json({
      message: 'Invitation sent',
      invitation: {
        id: invite.rows[0].id,
        email,
        role,
        expires_at: invite.rows[0].expires_at,
      },
    });
  } catch (error) {
    console.error('Invite error:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// Remove team member
app.delete('/api/org/:orgSlug/members/:userId', authenticateToken, requireOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { userId } = req.params;

  try {
    // Can't remove yourself
    if (parseInt(userId) === req.user.userId) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    // Can't remove the last owner
    if (req.userRole !== 'owner') {
      const targetRole = await pool.query(
        'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [req.org.id, userId]
      );
      if (targetRole.rows[0]?.role === 'owner') {
        return res.status(403).json({ error: 'Only owners can remove other owners' });
      }
    }

    const deleted = await pool.query(
      'DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2 RETURNING *',
      [req.org.id, userId]
    );

    if (!deleted.rows.length) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await logAudit(req.org.id, req.user.userId, 'member.removed', 'user', userId);

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = {
  // Export for testing or separate file usage
};
