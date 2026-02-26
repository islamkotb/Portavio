-- =============================================================================
-- Portavio SaaS Migration — Multi-Tenancy + Billing
-- Run this AFTER the base schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: Organizations (Workspaces)
-- The top-level billing & access entity. Every customer is one organization.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(255) NOT NULL,
    slug                    VARCHAR(100) UNIQUE NOT NULL,       -- URL-safe identifier
    plan                    VARCHAR(50) DEFAULT 'trial',        -- trial, starter, pro, enterprise
    trial_ends_at           TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),

    -- Stripe
    stripe_customer_id      VARCHAR(255) UNIQUE,
    stripe_subscription_id  VARCHAR(255) UNIQUE,
    subscription_status     VARCHAR(50) DEFAULT 'trialing',     -- trialing, active, past_due, canceled, paused

    -- Plan limits (denormalized for fast enforcement)
    max_users               INTEGER DEFAULT 3,
    max_projects            INTEGER DEFAULT 5,
    sync_frequency_minutes  INTEGER DEFAULT 1440,               -- 1440 = once/day for trial

    -- Metadata
    billing_email           VARCHAR(255),
    logo_url                VARCHAR(500),
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- STEP 2: Organization Membership
-- Many users can belong to one organization, with different roles.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization_members (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(50) DEFAULT 'member',               -- owner, admin, member, viewer
    invited_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- -----------------------------------------------------------------------------
-- STEP 3: Invitations
-- Token-based invite system for adding team members.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invitations (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    token           VARCHAR(255) UNIQUE NOT NULL,
    role            VARCHAR(50) DEFAULT 'member',
    invited_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at     TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- STEP 4: Billing Events Log
-- Audit trail of all Stripe events — essential for support & debugging.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_events (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    stripe_event_id VARCHAR(255) UNIQUE,
    event_type      VARCHAR(100) NOT NULL,                      -- checkout.session.completed, etc.
    amount_cents    INTEGER,
    currency        VARCHAR(10),
    status          VARCHAR(50),
    payload         JSONB,                                      -- full Stripe event for debugging
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- STEP 5: Migrate jira_connections to be owned by organization
-- In SaaS, connections belong to the org, not to an individual user.
-- -----------------------------------------------------------------------------

-- Add organization_id to jira_connections
ALTER TABLE jira_connections
    ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;

-- NOTE: After data migration, drop the old user_id column:
-- ALTER TABLE jira_connections DROP COLUMN user_id;
-- For now, keep user_id so you can backfill organization_id from it.

-- -----------------------------------------------------------------------------
-- STEP 6: Audit Log
-- Track all significant actions for enterprise compliance.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,                      -- e.g. 'jira.sync', 'member.invited', 'plan.upgraded'
    resource_type   VARCHAR(50),                                -- 'organization', 'project', 'team', etc.
    resource_id     INTEGER,
    metadata        JSONB,                                      -- extra context
    ip_address      VARCHAR(45),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- STEP 7: Email Queue
-- Track sent emails for audit trail and rate limiting.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_log (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    email_type      VARCHAR(100) NOT NULL,                      -- 'welcome', 'invite', 'trial_ending', etc.
    recipient       VARCHAR(255) NOT NULL,
    subject         VARCHAR(500),
    status          VARCHAR(50) DEFAULT 'sent',                 -- sent, failed, bounced
    provider_id     VARCHAR(255),                               -- SendGrid/Resend message ID
    sent_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- STEP 8: Add email_verified to users
-- Required for SaaS — prevents disposable email abuse.
-- -----------------------------------------------------------------------------

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS email_verify_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_login_at      TIMESTAMP,
    ADD COLUMN IF NOT EXISTS avatar_url         VARCHAR(500);

-- -----------------------------------------------------------------------------
-- STEP 9: Usage Tracking
-- Know which features customers actually use — essential for product decisions.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_events (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_name      VARCHAR(100) NOT NULL,                      -- 'page.view', 'sync.triggered', 'export.csv', etc.
    properties      JSONB,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Partition by month for performance (optional, add when you have >1M rows)
-- CREATE INDEX idx_usage_events_org_date ON usage_events(organization_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_organizations_slug              ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer   ON organizations(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id              ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id             ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token               ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email               ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_billing_events_org_id           ON billing_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id                ON audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created               ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_org                ON usage_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created            ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_connections_org_id         ON jira_connections(organization_id);

-- -----------------------------------------------------------------------------
-- PLAN LIMITS VIEW
-- Easy reference for enforcement middleware.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_plan_limits AS
SELECT
    o.id              AS organization_id,
    o.name            AS organization_name,
    o.plan,
    o.subscription_status,
    o.trial_ends_at,
    o.max_users,
    o.max_projects,
    o.sync_frequency_minutes,
    (SELECT COUNT(*) FROM organization_members om WHERE om.organization_id = o.id) AS current_users,
    (SELECT COUNT(*) FROM jira_connections jc
     JOIN projects p ON p.jira_connection_id = jc.id
     WHERE jc.organization_id = o.id) AS current_projects,
    -- Is trial expired?
    CASE
        WHEN o.plan = 'trial' AND o.trial_ends_at < NOW() THEN true
        ELSE false
    END AS trial_expired,
    -- Is subscription active?
    CASE
        WHEN o.subscription_status IN ('active', 'trialing') THEN true
        ELSE false
    END AS is_active
FROM organizations o;

-- -----------------------------------------------------------------------------
-- UPDATED VIEWS - Include organization_id for filtering
-- -----------------------------------------------------------------------------

-- Drop old views
DROP VIEW IF EXISTS v_project_overview CASCADE;
DROP VIEW IF EXISTS v_team_overview CASCADE;
DROP VIEW IF EXISTS v_epic_overview CASCADE;

-- Recreate with organization_id
CREATE OR REPLACE VIEW v_project_overview AS
SELECT
    p.id,
    jc.organization_id,
    p.jira_project_id,
    p.jira_project_key,
    p.name as project_name,
    p.status,
    p.health,
    p.description,
    COUNT(DISTINCT e.id) as epic_count,
    COUNT(DISTINCT tp.team_id) as team_count,
    COALESCE(SUM(e.total_story_points), 0) as total_story_points,
    COALESCE(AVG(e.progress), 0)::int as avg_epic_progress,
    COUNT(DISTINCT CASE WHEN r.severity IN ('high', 'critical') AND r.status = 'open' THEN r.id END) as open_high_risks,
    COUNT(DISTINCT CASE WHEN b.status = 'active' THEN b.id END) as active_blockers,
    json_agg(DISTINCT jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'is_primary', tp.is_primary,
        'allocation_percentage', tp.allocation_percentage
    )) FILTER (WHERE t.id IS NOT NULL) as teams,
    json_agg(DISTINCT jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'status', e.status,
        'progress', e.progress
    )) FILTER (WHERE e.id IS NOT NULL) as epics
FROM projects p
JOIN jira_connections jc ON p.jira_connection_id = jc.id
LEFT JOIN epics e ON e.project_id = p.id
LEFT JOIN team_projects tp ON tp.project_id = p.id
LEFT JOIN teams t ON tp.team_id = t.id
LEFT JOIN risks r ON r.project_id = p.id
LEFT JOIN blockers b ON b.project_id = p.id
GROUP BY p.id, jc.organization_id, p.jira_project_id, p.jira_project_key, p.name, p.status, p.health, p.description;

CREATE OR REPLACE VIEW v_team_overview AS
SELECT
    t.id,
    jc.organization_id,
    t.jira_team_id,
    t.name as team_name,
    t.capacity,
    t.velocity,
    t.current_load,
    t.predictability_score,
    t.member_count,
    COUNT(DISTINCT tp.project_id) as project_count,
    COUNT(DISTINCT et.epic_id) as epic_count,
    COUNT(DISTINCT CASE WHEN b.status = 'active' THEN b.id END) as active_blockers,
    json_agg(DISTINCT jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'is_primary', tp.is_primary
    )) FILTER (WHERE p.id IS NOT NULL) as projects,
    json_agg(DISTINCT jsonb_build_object(
        'epic_id', e.id,
        'epic_name', e.name,
        'is_owner', et.is_owner,
        'progress', e.progress,
        'contribution_percentage', et.contribution_percentage
    )) FILTER (WHERE e.id IS NOT NULL) as epics
FROM teams t
JOIN jira_connections jc ON t.jira_connection_id = jc.id
LEFT JOIN team_projects tp ON tp.team_id = t.id
LEFT JOIN projects p ON tp.project_id = p.id
LEFT JOIN epic_teams et ON et.team_id = t.id
LEFT JOIN epics e ON et.epic_id = e.id
LEFT JOIN blockers b ON b.team_id = t.id
GROUP BY t.id, jc.organization_id, t.jira_team_id, t.name, t.capacity, t.velocity, t.current_load, t.predictability_score, t.member_count;

CREATE OR REPLACE VIEW v_epic_overview AS
SELECT
    e.id,
    jc.organization_id,
    e.jira_epic_id,
    e.jira_epic_key,
    e.name as epic_name,
    e.status,
    e.progress,
    e.total_story_points,
    e.completed_story_points,
    p.id as project_id,
    p.name as project_name,
    p.jira_project_key,
    owner_team.id as owner_team_id,
    owner_team.name as owner_team_name,
    COUNT(DISTINCT et.team_id) as contributing_team_count,
    COUNT(DISTINCT d_source.id) as blocks_count,
    COUNT(DISTINCT d_target.id) as blocked_by_count,
    json_agg(DISTINCT jsonb_build_object(
        'team_id', contrib_team.id,
        'name', contrib_team.name,
        'is_owner', et.is_owner,
        'contribution_percentage', et.contribution_percentage
    )) FILTER (WHERE contrib_team.id IS NOT NULL) as contributing_teams
FROM epics e
JOIN jira_connections jc ON e.jira_connection_id = jc.id
LEFT JOIN projects p ON e.project_id = p.id
LEFT JOIN epic_teams et ON et.epic_id = e.id
LEFT JOIN teams contrib_team ON et.team_id = contrib_team.id
LEFT JOIN epic_teams owner_et ON owner_et.epic_id = e.id AND owner_et.is_owner = true
LEFT JOIN teams owner_team ON owner_et.team_id = owner_team.id
LEFT JOIN dependencies d_source ON d_source.source_epic_id = e.id
LEFT JOIN dependencies d_target ON d_target.target_epic_id = e.id
GROUP BY e.id, jc.organization_id, e.jira_epic_id, e.jira_epic_key, e.name, e.status, e.progress, e.total_story_points, e.completed_story_points, p.id, p.name, p.jira_project_key, owner_team.id, owner_team.name;

-- -----------------------------------------------------------------------------
-- DATA MIGRATION HELPER
-- Run once to create organizations for existing users (if migrating from self-hosted)
-- -----------------------------------------------------------------------------

-- INSERT INTO organizations (name, slug, plan, subscription_status)
-- SELECT
--     name,
--     LOWER(REGEXP_REPLACE(email, '[^a-zA-Z0-9]', '-', 'g')) AS slug,
--     'trial' AS plan,
--     'trialing' AS subscription_status
-- FROM users;
--
-- INSERT INTO organization_members (organization_id, user_id, role)
-- SELECT o.id, u.id, 'owner'
-- FROM users u
-- JOIN organizations o ON o.slug = LOWER(REGEXP_REPLACE(u.email, '[^a-zA-Z0-9]', '-', 'g'));
--
-- UPDATE jira_connections jc
-- SET organization_id = om.organization_id
-- FROM organization_members om
-- WHERE om.user_id = jc.user_id AND om.role = 'owner';
