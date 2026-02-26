# 🎯 Quick Reference: Marking Items in Jira

Use this guide to ensure your Jira issues are correctly detected by the dashboard.

## ⚠️ How to Mark RISKS in Jira

### Method 1: Labels (Recommended)
Add one of these labels to any issue:
- `risk` - General risk (medium severity)
- `risk-high` - High severity risk
- `risk-medium` - Medium severity risk
- `risk-low` - Low severity risk

**Example:**
```
Issue: "Vendor may not meet deadline"
Add Label: risk-high
```

### Method 2: Priority
Set issue priority to:
- **Highest** - Will be detected as high-severity risk
- **Critical** - Will be detected as high-severity risk

**Example:**
```
Issue: "Security vulnerability discovered"
Priority: Highest
```

### Method 3: Issue Type
If you have a custom "Risk" issue type:
```
Create Issue
Issue Type: Risk
Summary: "Data center reliability concerns"
```

### Method 4: Summary Prefix
Start your issue summary with "RISK:"
```
Summary: "RISK: Third-party API deprecation"
```

---

## 🚫 How to Mark BLOCKERS in Jira

### Method 1: Status (Recommended)
Change issue status to "Blocked"

**Steps:**
1. Open the issue
2. Click status dropdown
3. Select "Blocked"

> Note: If "Blocked" status doesn't exist, add it to your workflow

### Method 2: Labels
Add one of these labels:
- `blocked` - Issue is blocked
- `blocker` - This issue blocks others
- `impediment` - Team impediment

**Example:**
```
Issue: "Cannot proceed without server access"
Add Label: blocked
```

### Method 3: Flag Issue
Use Jira's built-in flag feature:
1. Open the issue
2. Click the flag icon
3. Add reason (optional)

---

## 🔗 How to Create DEPENDENCIES in Jira

### Epic-to-Epic Links (Detected Automatically)

**Steps:**
1. Open Epic A
2. Click "Link" or "Link Issue" (in more actions menu)
3. Select link type:
   - **Blocks** - Epic A blocks Epic B
   - **Is blocked by** - Epic A is blocked by Epic B
   - **Depends on** - Epic A depends on Epic B
   - **Requires** - Epic A requires Epic B
4. Search for and select Epic B
5. Click "Link"

**Example:**
```
Epic: "Mobile App Redesign"
Links:
  - Blocks: "App Store Deployment"
  - Depends on: "API v2 Migration"
  - Requires: "User Authentication System"
```

**Important:** 
- Only Epic-to-Epic links are tracked as dependencies
- Story-to-Story links are not tracked (yet)
- Links must be between epics in synced projects

---

## 🎨 Visual Examples

### Risk Example in Jira UI
```
┌─────────────────────────────────────────────┐
│ Issue: PROJ-123                             │
│ Summary: Database capacity reaching limit   │
│ Type: Story                                 │
│ Priority: Highest                           │
│ Labels: risk-high                           │
│ Status: Open                                │
└─────────────────────────────────────────────┘
        ↓
    Dashboard will show as HIGH RISK
```

### Blocker Example in Jira UI
```
┌─────────────────────────────────────────────┐
│ Issue: PROJ-456                             │
│ Summary: Waiting for legal approval         │
│ Type: Task                                  │
│ Status: BLOCKED                             │
│ Labels: blocked                             │
│ Flagged: Yes ⚑                              │
└─────────────────────────────────────────────┘
        ↓
    Dashboard will show as ACTIVE BLOCKER
```

### Dependency Example in Jira UI
```
Epic A: "Payment System"
    ↓ (blocks)
Epic B: "Subscription Features"
    ↓ (depends on)
Epic C: "User Management"

        ↓
    Dashboard shows:
    Payment System → blocks → Subscription Features
    Subscription Features → depends on → User Management
```

---

## 📋 Checklist for Portfolio Managers

Before syncing, ensure your Jira has:

- [ ] Risk items labeled with `risk`, `risk-high`, `risk-medium`, or `risk-low`
- [ ] High-priority items marked as "Highest" or "Critical"
- [ ] "Blocked" status available in workflow (or blocked items labeled)
- [ ] Epic-to-Epic links created for dependencies
- [ ] All important epics created in Jira

---

## 🔄 After Marking Items

1. Go to the dashboard
2. Click "Sync" button (or POST to `/api/jira/sync`)
3. Wait for sync to complete (30s - 2min depending on size)
4. Refresh the dashboard
5. Your risks, blockers, and dependencies will appear!

---

## 💡 Pro Tips

### For Risks:
- Use `risk-high` for urgent risks requiring immediate attention
- Add detailed descriptions to help with mitigation planning
- Link risks to affected epics in Jira

### For Blockers:
- Update blocker status when resolved (change from "Blocked" to "In Progress")
- Add comments explaining what's blocking and who can unblock
- Use assignee to track ownership

### For Dependencies:
- Use "Blocks" for hard dependencies (can't proceed without)
- Use "Depends on" for soft dependencies (nice to have)
- Keep dependency chains short to avoid complexity

### For Better Tracking:
- Review and update labels weekly
- Remove resolved risks/blockers from labels
- Document mitigation in issue description
- Use Jira's native flag feature for visibility

---

## 🎯 Quick Wins

Want to see data immediately? Do this:

1. **Add 3 risk labels**: Add `risk-high` to your top 3 risky issues
2. **Mark 2 blockers**: Add `blocked` label to currently blocked work
3. **Create 1 dependency**: Link two epics with "Blocks" or "Depends on"
4. **Sync the dashboard**: Click sync and watch them appear!

---

## ❓ FAQ

**Q: Can I use different label names?**
A: Yes! Edit the JQL in `backend/server.js` getRisks() method

**Q: Do I need a "Blocked" status?**
A: No, you can use labels or flags instead

**Q: Can I track Story-to-Story dependencies?**
A: Not currently - only Epic-to-Epic links are tracked

**Q: What if I use a different priority scheme?**
A: Customize the severity mapping in the sync function

**Q: Can I manually add risks/blockers?**
A: Not yet, but this feature could be added

---

## 📞 Need Help?

- Check [SYNC_EXPLAINED.md](SYNC_EXPLAINED.md) for technical details
- Review [README.md](README.md) for full documentation
- Test your JQL queries in Jira first
- Check backend logs for sync errors

---

**Happy labeling! 🏷️**

Remember: The dashboard is only as good as your Jira data!
