// ============================================================================
// JIRA CONNECTION ROUTES - MULTI-TENANT VERSION
// Replace the Jira section in server.js with this
// ============================================================================

// Connect to Jira (org-level, not user-level)
app.post('/api/jira/connect', authenticateToken, requireOrg, requireRole(['owner', 'admin']), async (req, res) => {
  const { jiraUrl, jiraEmail, jiraApiToken } = req.body;

  if (!jiraUrl || !jiraEmail || !jiraApiToken) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    // Test connection first
    const encToken = encrypt(jiraApiToken);
    const jira = new JiraClient(jiraUrl, jiraEmail, encToken);
    const test = await jira.testConnection();

    if (!test.success) {
      return res.status(400).json({
        error: 'Jira connection failed',
        details: test.error,
      });
    }

    // Save connection at org level
    const result = await pool.query(
      `INSERT INTO jira_connections (organization_id, jira_url, jira_email, jira_api_token, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (organization_id)
       DO UPDATE SET
         jira_url = $2,
         jira_email = $3,
         jira_api_token = $4,
         is_active = true,
         updated_at = NOW()
       RETURNING id, jira_url, jira_email`,
      [req.org.id, jiraUrl, jiraEmail, encToken]
    );

    await logAudit(req.org.id, req.user.userId, 'jira.connected', 'jira_connection', result.rows[0].id, {
      jira_url: jiraUrl,
      jira_user: test.user?.displayName,
    });

    res.json({
      message: 'Connected to Jira',
      connection: result.rows[0],
      jiraUser: test.user,
    });
  } catch (error) {
    console.error('Jira connect error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
});

// Get Jira connection status
app.get('/api/jira/status', authenticateToken, requireOrg, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, jira_url, jira_email, is_active, last_sync, created_at, updated_at
       FROM jira_connections
       WHERE organization_id = $1`,
      [req.org.id]
    );

    if (!result.rows.length) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      connection: result.rows[0],
    });
  } catch (error) {
    console.error('Jira status error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// Disconnect from Jira
app.delete('/api/jira/disconnect', authenticateToken, requireOrg, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE jira_connections SET is_active = false WHERE organization_id = $1 RETURNING id',
      [req.org.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'No connection found' });
    }

    await logAudit(req.org.id, req.user.userId, 'jira.disconnected', 'jira_connection', result.rows[0].id);

    res.json({ message: 'Disconnected from Jira' });
  } catch (error) {
    console.error('Jira disconnect error:', error);
    res.status(500).json({ error: 'Disconnect failed' });
  }
});

// Trigger manual sync
app.post('/api/jira/sync', authenticateToken, requireOrg, checkPlanLimit('syncsPerDay'), async (req, res) => {
  try {
    // Get org's Jira connection
    const connResult = await pool.query(
      `SELECT id, jira_url, jira_email, jira_api_token
       FROM jira_connections
       WHERE organization_id = $1 AND is_active = true`,
      [req.org.id]
    );

    if (!connResult.rows.length) {
      return res.status(404).json({ error: 'No active Jira connection' });
    }

    const connection = connResult.rows[0];
    connection.jira_api_token = decrypt(connection.jira_api_token);

    // Run sync
    const stats = await syncJiraData(connection);

    // Update last sync timestamp
    await pool.query(
      'UPDATE jira_connections SET last_sync = NOW() WHERE id = $1',
      [connection.id]
    );

    await logAudit(req.org.id, req.user.userId, 'jira.synced', 'jira_connection', connection.id, { stats });

    res.json({
      message: 'Sync completed',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync failed:', error);
    await logAudit(req.org.id, req.user.userId, 'jira.sync_failed', 'jira_connection', null, {
      error: error.message,
    });
    res.status(500).json({ error: 'Sync failed', details: error.message });
  }
});

// Helper: Get connection for org (used by sync worker)
async function getConnectionForOrg(organizationId) {
  const result = await pool.query(
    `SELECT id, jira_url, jira_email, jira_api_token
     FROM jira_connections
     WHERE organization_id = $1 AND is_active = true`,
    [organizationId]
  );

  if (!result.rows.length) return null;

  const conn = result.rows[0];
  conn.jira_api_token = decrypt(conn.jira_api_token);
  return conn;
}

module.exports = {
  getConnectionForOrg,
};
