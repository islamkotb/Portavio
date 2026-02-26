// ============================================================================
// DASHBOARD ROUTES - MULTI-TENANT VERSION
// These routes now query data scoped to the organization
// ============================================================================

// Overview dashboard
app.get('/api/dashboard/overview', authenticateToken, requireOrg, async (req, res) => {
  try {
    // Get all metrics for this org
    const metrics = await pool.query(
      `WITH org_connection AS (
        SELECT id FROM jira_connections WHERE organization_id = $1
      )
      SELECT
        (SELECT COUNT(*) FROM projects p WHERE p.jira_connection_id IN (SELECT id FROM org_connection)) as total_projects,
        (SELECT COUNT(*) FROM teams t WHERE t.jira_connection_id IN (SELECT id FROM org_connection)) as total_teams,
        (SELECT COUNT(*) FROM epics e WHERE e.jira_connection_id IN (SELECT id FROM org_connection)) as total_epics,
        (SELECT COUNT(*) FROM issues i WHERE i.jira_connection_id IN (SELECT id FROM org_connection)) as total_issues,
        (SELECT COALESCE(AVG(velocity), 0)::int FROM teams t WHERE t.jira_connection_id IN (SELECT id FROM org_connection)) as avg_velocity,
        (SELECT COUNT(*) FROM risks r 
         JOIN projects p ON r.project_id = p.id 
         WHERE p.jira_connection_id IN (SELECT id FROM org_connection) AND r.status = 'open') as open_risks,
        (SELECT COUNT(*) FROM blockers b 
         JOIN teams t ON b.team_id = t.id 
         WHERE t.jira_connection_id IN (SELECT id FROM org_connection) AND b.status = 'active') as active_blockers`,
      [req.org.id]
    );

    // Projects by health
    const projectsByHealth = await pool.query(
      `SELECT health, COUNT(*) as total
       FROM projects p
       JOIN jira_connections jc ON p.jira_connection_id = jc.id
       WHERE jc.organization_id = $1
       GROUP BY health`,
      [req.org.id]
    );

    // Epics by status
    const epicsByStatus = await pool.query(
      `SELECT status, COUNT(*) as total
       FROM epics e
       JOIN jira_connections jc ON e.jira_connection_id = jc.id
       WHERE jc.organization_id = $1
       GROUP BY status`,
      [req.org.id]
    );

    const data = metrics.rows[0];

    res.json({
      projects: {
        total: parseInt(data.total_projects || 0),
        byHealth: projectsByHealth.rows,
      },
      teams: {
        total: parseInt(data.total_teams || 0),
      },
      epics: {
        total: parseInt(data.total_epics || 0),
        byStatus: epicsByStatus.rows,
      },
      issues: {
        total: parseInt(data.total_issues || 0),
      },
      avgVelocity: parseInt(data.avg_velocity || 0),
      openRisks: parseInt(data.open_risks || 0),
      activeBlockers: parseInt(data.active_blockers || 0),
    });
  } catch (error) {
    console.error('Overview error:', error);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// Projects dashboard
app.get('/api/dashboard/projects', authenticateToken, requireOrg, async (req, res) => {
  try {
    const projects = await pool.query(
      `SELECT * FROM v_project_overview vo
       WHERE vo.organization_id = $1
       ORDER BY vo.project_name`,
      [req.org.id]
    );

    res.json({ projects: projects.rows });
  } catch (error) {
    console.error('Projects fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Teams dashboard
app.get('/api/dashboard/teams', authenticateToken, requireOrg, async (req, res) => {
  try {
    const teams = await pool.query(
      `SELECT * FROM v_team_overview vt
       WHERE vt.organization_id = $1
       ORDER BY vt.team_name`,
      [req.org.id]
    );

    res.json({ teams: teams.rows });
  } catch (error) {
    console.error('Teams fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// Epics dashboard
app.get('/api/dashboard/epics', authenticateToken, requireOrg, async (req, res) => {
  try {
    const epics = await pool.query(
      `SELECT * FROM v_epic_overview ve
       WHERE ve.organization_id = $1
       ORDER BY ve.epic_name`,
      [req.org.id]
    );

    res.json({ epics: epics.rows });
  } catch (error) {
    console.error('Epics fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch epics' });
  }
});

// Risks
app.get('/api/dashboard/risks', authenticateToken, requireOrg, async (req, res) => {
  try {
    const risks = await pool.query(
      `SELECT r.*, p.name as project_name, p.jira_project_key
       FROM risks r
       LEFT JOIN projects p ON r.project_id = p.id
       JOIN jira_connections jc ON p.jira_connection_id = jc.id
       WHERE jc.organization_id = $1 AND r.status = 'open'
       ORDER BY
         CASE r.severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           ELSE 4
         END,
         r.identified_date DESC`,
      [req.org.id]
    );

    res.json({ risks: risks.rows });
  } catch (error) {
    console.error('Risks fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch risks' });
  }
});

// Blockers
app.get('/api/dashboard/blockers', authenticateToken, requireOrg, async (req, res) => {
  try {
    const blockers = await pool.query(
      `SELECT b.*,
         t.name as team_name,
         e.name as epic_name,
         p.name as project_name
       FROM blockers b
       LEFT JOIN teams t ON b.team_id = t.id
       LEFT JOIN epics e ON b.epic_id = e.id
       LEFT JOIN projects p ON b.project_id = p.id
       JOIN jira_connections jc ON t.jira_connection_id = jc.id
       WHERE jc.organization_id = $1 AND b.status = 'active'
       ORDER BY b.blocked_since ASC`,
      [req.org.id]
    );

    res.json({ blockers: blockers.rows });
  } catch (error) {
    console.error('Blockers fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch blockers' });
  }
});

// Dependencies
app.get('/api/dashboard/dependencies', authenticateToken, requireOrg, async (req, res) => {
  try {
    const dependencies = await pool.query(
      `SELECT d.*,
         e1.name as source_epic,
         e2.name as target_epic,
         p1.name as source_project,
         p2.name as target_project,
         t1.name as source_team,
         t2.name as target_team,
         e1.status as source_status,
         e2.status as target_status
       FROM dependencies d
       LEFT JOIN epics e1 ON d.source_epic_id = e1.id
       LEFT JOIN epics e2 ON d.target_epic_id = e2.id
       LEFT JOIN projects p1 ON e1.project_id = p1.id
       LEFT JOIN projects p2 ON e2.project_id = p2.id
       LEFT JOIN epic_teams et1 ON et1.epic_id = e1.id AND et1.is_owner = true
       LEFT JOIN epic_teams et2 ON et2.epic_id = e2.id AND et2.is_owner = true
       LEFT JOIN teams t1 ON et1.team_id = t1.id
       LEFT JOIN teams t2 ON et2.team_id = t2.id
       JOIN jira_connections jc ON e1.jira_connection_id = jc.id
       WHERE jc.organization_id = $1
       ORDER BY d.created_at DESC`,
      [req.org.id]
    );

    res.json({ dependencies: dependencies.rows });
  } catch (error) {
    console.error('Dependencies fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch dependencies' });
  }
});

// Timeline / Roadmap
app.get('/api/dashboard/timeline', authenticateToken, requireOrg, async (req, res) => {
  try {
    const timeline = await pool.query(
      `SELECT t.*,
         p.name as project_name,
         tm.name as team_name,
         e.name as epic_name
       FROM timeline t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN teams tm ON t.team_id = tm.id
       LEFT JOIN epics e ON t.epic_id = e.id
       JOIN jira_connections jc ON p.jira_connection_id = jc.id
       WHERE jc.organization_id = $1
       ORDER BY t.event_date ASC NULLS LAST`,
      [req.org.id]
    );

    res.json({ timeline: timeline.rows });
  } catch (error) {
    console.error('Timeline fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// Velocity history
app.get('/api/dashboard/velocity-history', authenticateToken, requireOrg, async (req, res) => {
  try {
    const velocity = await pool.query(
      `SELECT t.id, t.name as team_name,
         json_agg(
           json_build_object(
             'sprint_name', s.name,
             'velocity', s.velocity,
             'completed_at', s.end_date
           ) ORDER BY s.end_date DESC
         ) FILTER (WHERE s.velocity IS NOT NULL) as history
       FROM teams t
       LEFT JOIN sprints s ON s.team_id = t.id
       JOIN jira_connections jc ON t.jira_connection_id = jc.id
       WHERE jc.organization_id = $1
       GROUP BY t.id, t.name
       HAVING COUNT(s.id) > 0`,
      [req.org.id]
    );

    // Transform to match frontend expectations
    const velocityHistory = velocity.rows.map(team => ({
      teamName: team.team_name,
      history: (team.history || []).slice(0, 8), // Last 8 sprints
    }));

    res.json({ velocityHistory });
  } catch (error) {
    console.error('Velocity history error:', error);
    res.status(500).json({ error: 'Failed to fetch velocity history' });
  }
});

// Predictability scores
app.get('/api/dashboard/predictability', authenticateToken, requireOrg, async (req, res) => {
  try {
    const predictability = await pool.query(
      `SELECT t.name, t.velocity, t.predictability_score,
         (SELECT COUNT(*) FROM sprints WHERE team_id = t.id) as sprint_count
       FROM teams t
       JOIN jira_connections jc ON t.jira_connection_id = jc.id
       WHERE jc.organization_id = $1 AND t.predictability_score > 0
       ORDER BY t.predictability_score DESC`,
      [req.org.id]
    );

    res.json({ predictability: predictability.rows });
  } catch (error) {
    console.error('Predictability error:', error);
    res.status(500).json({ error: 'Failed to fetch predictability' });
  }
});

module.exports = {};
