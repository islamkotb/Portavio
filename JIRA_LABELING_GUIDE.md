# Quick Reference: Marking Items in Jira

Use this guide to ensure your Jira issues are correctly detected by the dashboard.

---

## ⚠️ Risks

Portavio detects risks in two ways: **manual labels** you apply in Jira, and **automatic detection** based on data patterns.

### Method 1: Labels (Manual)

Add one of these labels to any issue:

| Label | Severity |
|-------|----------|
| `risk` | Medium |
| `risk-high` | High |
| `risk-medium` | Medium |
| `risk-low` | Low |
| `RISK` | Medium |

### Method 2: Priority (Manual)

Set issue priority to **Highest** or **Critical** — these are automatically treated as high-severity risks.

### Auto-Detection (No Jira action needed)

Portavio automatically creates risks during each sync for the following patterns:

**Epic at Risk** — triggered when an epic is:
- Overdue (past due date)
- Less than 50% complete with under 7 days remaining
- Has story points but 0% progress

**Sprint at Risk** — triggered when an active sprint is:
- Past its end date with less than 100% completion
- Less than 50% complete with under 3 days remaining

**Team Overload** — triggered when a team's workload exceeds its velocity:
- Load > 100% → High severity
- Load > 90% → Medium severity

**Issue at Risk** — triggered for individual issues that are:
- High/Highest priority and unassigned
- In Progress for more than 7 days with no updates (stalled)
- Large story (8+ points) in an active sprint with fewer than 3 days left and not started
- Critical/Blocker priority bug that is unassigned

> Auto-detected risks are labelled with their type (Epic Risk, Sprint Risk, etc.) and can be filtered by type on the Risks page.

### Risks UI

The Risks page has **tabs** to filter by type:
- **All Risks** — everything
- **Issue Risks** — individual issue problems
- **Labeled Risks** — manually labeled in Jira
- **Sprint Risks** — at-risk sprints
- **Epic Risks** — at-risk epics
- **Team Overload** — overloaded teams

You can also filter by **Project** and **Team** using the dropdowns at the top.

---

## 🚫 Blockers

### Method 1: Status / Labels / Flag (Jira)

Any of the following will create a blocker:

| Approach | What to do in Jira |
|---|---|
| Status | Set issue status to **Blocked** |
| Label | Add label `blocked`, `blocker`, `impediment`, or `BLOCKED` |
| Flag | Click the flag icon on the issue |

### Method 2: Issue Links (Auto-detected)

If a synced issue has a **"is blocked by"** or **"blocks"** link to another synced issue, Portavio automatically creates a blocker entry. No manual labeling needed.

**Example:**
```
Issue: PROJ-101 "Deploy to production"
  → is blocked by: PROJ-88 "Security review"
```
→ Dashboard shows PROJ-101 as an active blocker.

### Blockers UI

The Blockers page shows each blocker with its linked **team**, **epic**, and **project**. Filter by **Project** or **Team** using the dropdowns at the top.

---

## 🎲 Predictability

Predictability is calculated automatically — no Jira configuration needed.

**How it works:**
For each team, Portavio looks at the last 6 completed sprints and measures how consistent the velocity is. A sprint is counted as "consistent" if its velocity is within ±20% of the team's average. Predictability score = (consistent sprints / total sprints) × 100.

**Score interpretation:**

| Score | Colour | Meaning |
|-------|--------|---------|
| 80–100% | 🟢 Green | Highly predictable — delivery is reliable |
| 60–79% | 🟡 Yellow | Moderately predictable — some variance |
| 0–59% | 🔴 Red | Unpredictable — velocity is inconsistent |

The Predictability page shows a card per team with their score, average velocity, and number of sprints analysed.

> Predictability requires at least 2 completed sprints to produce a meaningful score.

---

## 🔗 Dependencies

### Epic-to-Epic Links (Detected Automatically)

1. Open Epic A in Jira
2. Click **Link Issue**
3. Select a link type:
   - **Blocks** — Epic A blocks Epic B
   - **Is blocked by** — Epic A is blocked by Epic B
   - **Depends on** — Epic A depends on Epic B
   - **Requires** — Epic A requires Epic B
4. Select Epic B and save

**Note:** Only Epic-to-Epic links are tracked. Story-to-Story links are not.

---

## 📋 Checklist for Portfolio Managers

Before syncing, ensure your Jira has:

- [ ] Risk items labeled with `risk`, `risk-high`, `risk-medium`, or `risk-low` (or priority set to Highest/Critical)
- [ ] Blocked issues have status **Blocked**, a `blocked` label, or a flag
- [ ] Epic-to-Epic links created for hard dependencies
- [ ] Active sprints have realistic end dates set (required for sprint risk detection)
- [ ] Issues assigned where possible (unassigned high-priority issues trigger auto-risks)

---

## 🔄 After Marking Items

1. Go to the dashboard
2. Click **Sync Jira**
3. Wait 30 seconds – 2 minutes depending on portfolio size
4. Refresh — risks, blockers, and dependencies will appear

---

## 💡 Tips

**Risks:**
- Auto-detection runs on every sync — no extra work needed once Jira data is up to date
- Manually label only risks that don't fit auto-detection (e.g. vendor risk, compliance risk)
- Resolve risks in Jira (close/resolve the issue) and re-sync to clear them

**Blockers:**
- Update the issue status to Done or remove the label when a blocker is resolved, then re-sync
- Issue-link blockers are resolved automatically when the blocking issue is resolved in Jira

**Predictability:**
- Scores improve over time as more sprint data accumulates
- Irregular sprint lengths or cancelled sprints will lower scores temporarily

---

## ❓ FAQ

**Q: Do I need to do anything for auto-detected risks?**
A: No. Epic, sprint, team, and issue risks are detected automatically on every sync based on your Jira data.

**Q: Can I use different label names for risks?**
A: The supported labels are fixed (`risk`, `risk-high`, `risk-medium`, `risk-low`, `RISK`). Custom labels won't be picked up.

**Q: Do I need a "Blocked" status in Jira?**
A: No — labels (`blocked`, `blocker`, `impediment`) and the Jira flag icon both work as alternatives.

**Q: Can I track Story-to-Story dependencies?**
A: Not currently — only Epic-to-Epic links are tracked as dependencies. Story-to-Story blocked-by links are detected as blockers (not dependencies).

**Q: How many sprints does predictability need?**
A: At least 2 completed sprints. 6 or more gives the most accurate score.

**Q: Why is a team showing as overloaded?**
A: The team's current issue workload exceeds their average velocity. Reduce in-flight work or increase capacity in Jira.

---

## Need Help?

- Check [SYNC_EXPLAINED.md](SYNC_EXPLAINED.md) for technical sync details
- Check backend logs for sync errors (`railway logs`)
- Test your JQL queries in Jira's issue search before syncing
