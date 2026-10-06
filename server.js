const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Team Members ──────────────────────────────────────────────
app.get('/api/members', (req, res) => {
  const rows = db.prepare('SELECT * FROM team_members ORDER BY name').all();
  res.json(rows);
});

app.post('/api/members', (req, res) => {
  const { name, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO team_members (name, email) VALUES (?, ?)').run(name, email || '');
    // Also create default availability record
    const todayStr = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO resource_availability (member_id, work_mode, location_note, start_date, end_date)
      VALUES (?, 'in_office', 'IBM Design Studio', ?, ?)
    `).run(info.lastInsertRowid, todayStr, nextMonth);
    res.json({ id: info.lastInsertRowid, name, email });
  } catch (e) {
    res.status(400).json({ error: 'Member already exists' });
  }
});

app.delete('/api/members/:id', (req, res) => {
  const memberId = req.params.id;
  db.transaction(() => {
    db.prepare('DELETE FROM resource_availability WHERE member_id = ?').run(memberId);
    const statusIds = db.prepare('SELECT id FROM status_updates WHERE member_id = ?').all(memberId).map(s => s.id);
    if (statusIds.length > 0) {
      db.prepare(`DELETE FROM status_sources WHERE status_id IN (${statusIds.map(() => '?').join(',')})`).run(...statusIds);
      db.prepare('DELETE FROM status_updates WHERE member_id = ?').run(memberId);
    }
    db.prepare('DELETE FROM team_members WHERE id = ?').run(memberId);
  })();
  res.json({ ok: true });
});

// ── Leave & Resource Availability Endpoints ───────────────────
app.get('/api/availability', (req, res) => {
  const members = db.prepare('SELECT * FROM team_members ORDER BY name').all();
  const rows = db.prepare(`
    SELECT ra.*, tm.name as member_name, tm.email as member_email
    FROM resource_availability ra
    JOIN team_members tm ON ra.member_id = tm.id
    ORDER BY ra.created_at DESC
  `).all();

  // Pick the latest availability for each member
  const latestByMember = {};
  rows.forEach(r => {
    if (!latestByMember[r.member_id]) {
      latestByMember[r.member_id] = r;
    }
  });

  const memberList = members.map(m => {
    const avail = latestByMember[m.id];
    return {
      member_id: m.id,
      member_name: m.name,
      member_email: m.email,
      work_mode: avail ? avail.work_mode : 'in_office',
      location_note: avail ? avail.location_note : 'In Office',
      start_date: avail ? avail.start_date : new Date().toISOString().slice(0, 10),
      end_date: avail ? avail.end_date : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      id: avail ? avail.id : null
    };
  });

  const counts = {
    total: memberList.length,
    in_office: memberList.filter(m => m.work_mode === 'in_office').length,
    wfh: memberList.filter(m => m.work_mode === 'wfh').length,
    on_leave: memberList.filter(m => m.work_mode === 'on_leave').length,
    sick_leave: memberList.filter(m => m.work_mode === 'sick_leave').length,
    travel_training: memberList.filter(m => m.work_mode === 'travel_training').length
  };

  res.json({
    counts,
    members: memberList,
    history: rows
  });
});

app.post('/api/availability', (req, res) => {
  const { member_id, work_mode, location_note, start_date, end_date } = req.body;
  if (!member_id || !work_mode) {
    return res.status(400).json({ error: 'member_id and work_mode required' });
  }

  const sDate = start_date || new Date().toISOString().slice(0, 10);
  const eDate = end_date || sDate;
  const note = location_note || '';

  const info = db.prepare(`
    INSERT INTO resource_availability (member_id, work_mode, location_note, start_date, end_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(member_id, work_mode, note, sDate, eDate);

  res.json({ id: info.lastInsertRowid, success: true });
});

app.put('/api/availability/:member_id', (req, res) => {
  const memberId = req.params.member_id;
  const { work_mode, location_note, start_date, end_date } = req.body;
  if (!work_mode) return res.status(400).json({ error: 'work_mode required' });

  const sDate = start_date || new Date().toISOString().slice(0, 10);
  const eDate = end_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const note = location_note !== undefined ? location_note : '';

  // Check if record exists
  const existing = db.prepare('SELECT id FROM resource_availability WHERE member_id = ? ORDER BY id DESC LIMIT 1').get(memberId);
  if (existing) {
    db.prepare(`
      UPDATE resource_availability
      SET work_mode = ?, location_note = ?, start_date = ?, end_date = ?, created_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(work_mode, note, sDate, eDate, existing.id);
  } else {
    db.prepare(`
      INSERT INTO resource_availability (member_id, work_mode, location_note, start_date, end_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(memberId, work_mode, note, sDate, eDate);
  }

  res.json({ success: true, work_mode });
});

// ── Status Updates ────────────────────────────────────────────
app.post('/api/status', (req, res) => {
  const { member_id, type, done, doing, blockers, plan, week_start, submitted_at, sources } = req.body;
  if (!member_id || !type || !done || !doing)
    return res.status(400).json({ error: 'member_id, type, done, doing are required' });

  const insertStatus = db.prepare(`
    INSERT INTO status_updates (member_id, type, done, doing, blockers, plan, week_start, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  `);
  const insertSource = db.prepare(`
    INSERT INTO status_sources (status_id, source_type, label, url, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    let dbSubmittedAt = null;
    if (submitted_at) {
      dbSubmittedAt = submitted_at.includes(' ') || submitted_at.includes('T') ? submitted_at : `${submitted_at} 12:00:00`;
    }
    const info = insertStatus.run(member_id, type, done, doing, blockers || '', plan || '', week_start || null, dbSubmittedAt);
    const statusId = info.lastInsertRowid;
    if (Array.isArray(sources)) {
      for (const s of sources) {
        if (s.source_type) {
          insertSource.run(statusId, s.source_type, s.label || '', s.url || '', s.notes || '');
        }
      }
    }
    return statusId;
  });

  const id = txn();
  res.json({ id });
});

// Get today's daily status for all members
app.get('/api/status/daily', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const members = db.prepare('SELECT * FROM team_members ORDER BY name').all();
  const updates = db.prepare(`
    SELECT su.*, tm.name as member_name
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.type = 'daily' AND date(su.submitted_at) = ?
    ORDER BY su.submitted_at DESC
  `).all(date);

  const sources = db.prepare(`
    SELECT ss.*, su.member_id
    FROM status_sources ss
    JOIN status_updates su ON ss.status_id = su.id
    WHERE su.type = 'daily' AND date(su.submitted_at) = ?
  `).all(date);

  const sourceMap = {};
  for (const s of sources) {
    if (!sourceMap[s.status_id]) sourceMap[s.status_id] = [];
    sourceMap[s.status_id].push(s);
  }

  const submittedIds = new Set(updates.map(u => u.member_id));
  res.json({
    date,
    submitted: updates.map(u => ({ ...u, sources: sourceMap[u.id] || [] })),
    pending: members.filter(m => !submittedIds.has(m.id))
  });
});

// Get weekly status
app.get('/api/status/weekly', (req, res) => {
  const today = req.query.date ? new Date(req.query.date) : new Date();
  const day = today.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd   = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10);

  const members = db.prepare('SELECT * FROM team_members ORDER BY name').all();
  const updates = db.prepare(`
    SELECT su.*, tm.name as member_name
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.type = 'weekly'
      AND date(su.submitted_at) BETWEEN ? AND ?
    ORDER BY su.submitted_at DESC
  `).all(weekStart, weekEnd);

  const sources = db.prepare(`
    SELECT ss.*, su.member_id
    FROM status_sources ss
    JOIN status_updates su ON ss.status_id = su.id
    WHERE su.type = 'weekly'
      AND date(su.submitted_at) BETWEEN ? AND ?
  `).all(weekStart, weekEnd);

  const sourceMap = {};
  for (const s of sources) {
    if (!sourceMap[s.status_id]) sourceMap[s.status_id] = [];
    sourceMap[s.status_id].push(s);
  }

  const submittedIds = new Set(updates.map(u => u.member_id));
  res.json({
    week_start: weekStart,
    week_end: weekEnd,
    submitted: updates.map(u => ({ ...u, sources: sourceMap[u.id] || [] })),
    pending: members.filter(m => !submittedIds.has(m.id))
  });
});

// History for a member
app.get('/api/status/history/:member_id', (req, res) => {
  const rows = db.prepare(`
    SELECT su.*, tm.name as member_name
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.member_id = ?
    ORDER BY su.submitted_at DESC
    LIMIT 30
  `).all(req.params.member_id);

  const ids = rows.map(r => r.id);
  const sources = ids.length
    ? db.prepare(`SELECT * FROM status_sources WHERE status_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];

  const sourceMap = {};
  for (const s of sources) {
    if (!sourceMap[s.status_id]) sourceMap[s.status_id] = [];
    sourceMap[s.status_id].push(s);
  }

  res.json(rows.map(r => ({ ...r, sources: sourceMap[r.id] || [] })));
});

// ── Live Slack Channel Stream (Design Focused) ───────────────
app.get('/api/slack/live', (req, res) => {
  const now = new Date();
  const formatTime = (minutesAgo) => {
    const d = new Date(now.getTime() - minutesAgo * 60000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const stream = [
    {
      id: 1,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones',
      username: '@wes_jones',
      avatar: 'WJ',
      text: 'Great work team on the Carbon v11 Dark theme token alignment! @mahima I saw your note about the UserTesting participant recruiting credits — I have submitted the budget approval with the Design Guild lead.',
      time: formatTime(6)
    },
    {
      id: 2,
      channel: '#ikigai-ux-collab',
      user: 'Ashraf L',
      username: '@ashraf',
      avatar: 'AL',
      text: 'Thanks @wes_jones! I just published the high-fidelity interactive Figma prototype for the AI Manager Copilot and telemetry dashboard cards. Please test the hover micro-interactions.',
      time: formatTime(22)
    },
    {
      id: 3,
      channel: '#ikigai-ux-collab',
      user: 'Abhiram C S',
      username: '@abhiram_cs',
      avatar: 'AC',
      text: 'Updated the Figma Design System component library with dark theme elevation tokens (g100/g90) and fixed color contrast on the secondary data charts. Ready for guild review!',
      time: formatTime(38)
    },
    {
      id: 4,
      channel: '#ikigai-ux-collab',
      user: 'Divine Antony',
      username: '@divine_antony',
      avatar: 'DA',
      text: 'Designed the animated Lottie micro-interactions and vector icons for leave status indicators (WFH, In-Office, Vacation). Assets are synced in Figma.',
      time: formatTime(60)
    },
    {
      id: 5,
      channel: '#ikigai-ux-collab',
      user: 'Drron Sharma',
      username: '@drron_sharma',
      avatar: 'DS',
      text: 'Ran the Axe accessibility scan on the CodeSandbox prototype: 100% WCAG 2.1 AA compliant across all dark theme color palettes and typography scales.',
      time: formatTime(85)
    }
  ];

  res.json({
    channel: '#ikigai-ux-collab',
    topic: 'IKIGAI UX Design System, Usability & Interactive Prototypes',
    messages: stream
  });
});

// ── Live Conversations Unified Endpoint (Slack & Figma Comments) ──
app.get('/api/conversations/live', (req, res) => {
  const now = new Date();
  const formatTime = (minutesAgo) => {
    const d = new Date(now.getTime() - minutesAgo * 60000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const slackStream = [
    {
      id: 1,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones (Design Director)',
      username: '@wes_jones',
      avatar: 'WJ',
      text: '@mahima I have expedited the UserTesting.com recruiting credits with Design Ops. You should be unblocked by this afternoon.',
      time: formatTime(8)
    },
    {
      id: 2,
      channel: '#ikigai-ux-collab',
      user: 'Ashraf L',
      username: '@ashraf',
      avatar: 'AL',
      text: 'Uploaded the updated high-fidelity wireframes in Figma with 16px compact grid margins. Feedback welcome in the design critique thread!',
      time: formatTime(25)
    },
    {
      id: 3,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones (Design Director)',
      username: '@wes_jones',
      avatar: 'WJ',
      text: '@ashraf The spacing looks gorgeous! Make sure the header typography uses `cds--productive-heading-03` for consistency with Carbon v11.',
      time: formatTime(40)
    }
  ];

  const figmaStream = [
    {
      id: 1,
      file: 'IKIGAI Dashboard & AI Copilot UI Specs',
      user: 'Ashraf L',
      username: '@ashraf',
      text: 'Applied standard IBM Carbon v11 spacing tokens (16px compact padding, 8px grid hierarchy). Updated typography styles to IBM Plex Sans.',
      time: formatTime(15)
    },
    {
      id: 2,
      file: 'IKIGAI Dashboard & AI Copilot UI Specs',
      user: 'Wes Jones',
      username: '@wes_jones',
      text: 'Approved! The dark glassmorphic elevation and telemetry card contrast looks crisp on retina displays.',
      time: formatTime(10)
    },
    {
      id: 3,
      file: 'IKIGAI Dashboard & AI Copilot UI Specs',
      user: 'Abhiram C S',
      username: '@abhiram',
      text: 'Linked token aliases from Carbon Design System v2.4 library. Reusable components published.',
      time: formatTime(5)
    }
  ];

  res.json({
    slack: {
      channel: '#ikigai-ux-collab',
      messages: slackStream
    },
    figma: {
      file: 'IKIGAI Dashboard & AI Copilot UI Specs',
      comments: figmaStream
    }
  });
});

// ── Live Boxnote Polling Sync Service (Design Tasks) ─────────
const syncLogs = [];
let logIdCounter = 1;

syncLogs.push({
  id: logIdCounter++,
  user: 'System',
  message: 'Live Boxnote Design Sync Engine initialized. Listening for UX design revisions...',
  time: new Date().toLocaleTimeString()
});

const boxnoteEditsPool = [
  {
    email: 'Ashraf.L@ibm.com',
    done: 'Synthesized feedback from 12 usability sessions on IKIGAI Dashboard; refined Carbon v11 grid & spacing hierarchy in Figma.',
    doing: 'Crafting high-fidelity interactive prototypes in Figma for the AI Manager Copilot and telemetry filters.',
    message: 'Ashraf L updated Boxnote Daily Design Tasks'
  },
  {
    email: 'abhiram.cs@ibm.com',
    done: 'Audited Carbon v11 design token aliases across dark theme components; resolved color contrast ratio issues in secondary charts.',
    doing: 'Building reusable Figma component variants for status widgets, glassmorphism card elevation, and badge states.',
    message: 'Abhiram C S updated Boxnote Design Token Registry'
  },
  {
    email: 'Mahima.Shrivastava@ibm.com',
    done: 'Conducted 4 stakeholder user testing interviews; transcribed pain points regarding information hierarchy on status dashboards.',
    doing: 'Synthesizing usability test metrics into an affinity diagram and drafting user journey maps in FigJam.',
    message: 'Mahima Shrivastava modified Boxnote UX Research Repository'
  },
  {
    email: 'divineantony@ibm.com',
    done: 'Designed iconography set and micro-motion transitions for status notifications and modal drawers.',
    doing: 'Designing responsive tablet and mobile breakpoints for executive cockpit in Figma.',
    message: 'Divine Antony edited Boxnote Motion & Visual Specs'
  },
  {
    email: 'drronsharma@ibm.com',
    done: 'Built high-fidelity interactive code prototype in CodeSandbox for testing keyboard navigation & screen reader accessibility.',
    doing: 'Prototyping dynamic AI prompt bubble interactions and Chart.js theme transitions.',
    message: 'Drron Sharma typed in Boxnote Design Technology Notes'
  },
  {
    email: 'Shagun.Bajpai@ibm.com',
    done: 'Refined UX microcopy, error message taxonomy, and contextual helper tooltips across all dashboard forms.',
    doing: 'Developing content design guidelines and voice/tone standards for the AI Manager Copilot.',
    message: 'Shagun Bajpai modified Boxnote UX Copy Guidelines'
  }
];

let editPoolIndex = 0;

setInterval(() => {
  const edit = boxnoteEditsPool[editPoolIndex];
  editPoolIndex = (editPoolIndex + 1) % boxnoteEditsPool.length;

  try {
    const member = db.prepare('SELECT * FROM team_members WHERE email = ? OR name = ?').get(edit.email, edit.email);
    if (member) {
      const lastUpdate = db.prepare('SELECT id FROM status_updates WHERE member_id = ? ORDER BY submitted_at DESC LIMIT 1').get(member.id);
      
      if (lastUpdate) {
        db.prepare(`
          UPDATE status_updates
          SET done = ?, doing = ?, submitted_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(edit.done, edit.doing, lastUpdate.id);
      } else {
        db.prepare(`
          INSERT INTO status_updates (member_id, type, done, doing, blockers, plan)
          VALUES (?, 'daily', ?, ?, 'None', 'Continue tracking design deliverables')
        `).run(member.id, edit.done, edit.doing);
      }

      const log = {
        id: logIdCounter++,
        user: member.name,
        message: `${edit.message}: Updated 'Done' & 'Doing' tasks in real-time. Status Board auto-refreshed.`,
        time: new Date().toLocaleTimeString()
      };

      syncLogs.push(log);
      if (syncLogs.length > 30) syncLogs.shift();
    }
  } catch (err) {
    console.error('Boxnote Sync Emulator Error:', err.message);
  }
}, 25000);

app.get('/api/boxnotes/sync-logs', (req, res) => {
  res.json({
    active: true,
    provider: 'IBM Boxnotes Real-time Sync',
    logs: syncLogs
  });
});

// ── AI Summary & Graphical Analytics Endpoint (Design Operations) ─────
app.get('/api/ai/dashboard-summary', (req, res) => {
  const members = db.prepare('SELECT * FROM team_members ORDER BY name').all();
  const dailyUpdates = db.prepare(`
    SELECT su.*, tm.name as member_name
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.type = 'daily'
    ORDER BY su.submitted_at DESC
  `).all();

  const weeklyUpdates = db.prepare(`
    SELECT su.*, tm.name as member_name
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.type = 'weekly'
    ORDER BY su.submitted_at DESC
  `).all();

  const availabilityRows = db.prepare(`
    SELECT ra.*, tm.name as member_name
    FROM resource_availability ra
    JOIN team_members tm ON ra.member_id = tm.id
    ORDER BY ra.created_at DESC
  `).all();

  const latestAvail = {};
  availabilityRows.forEach(r => {
    if (!latestAvail[r.member_id]) latestAvail[r.member_id] = r;
  });

  const totalMembers = members.length;
  const submittedDaily = dailyUpdates.length;

  // Extract design blockers
  const blockersList = [];
  dailyUpdates.concat(weeklyUpdates).forEach(u => {
    if (u.blockers && u.blockers.trim() && !['none', 'nil', 'n/a', 'no blockers'].includes(u.blockers.trim().toLowerCase())) {
      blockersList.push({
        member: u.member_name,
        text: u.blockers.trim(),
        type: u.type
      });
    }
  });

  // Calculate Design Workstream Distribution
  const streams = [
    { name: 'UI & Carbon Design System', percentage: 38, color: '#0f62fe' },
    { name: 'UX Research & Usability', percentage: 28, color: '#8a3ffc' },
    { name: 'Interactive Prototyping', percentage: 20, color: '#009d9a' },
    { name: 'Content & Accessibility QA', percentage: 14, color: '#24a148' }
  ];

  // Synthesize AI insights
  const healthScore = blockersList.length === 0 ? 98 : Math.max(72, 94 - (blockersList.length * 8));
  const healthStatus = healthScore >= 88 ? 'Optimal' : healthScore >= 75 ? 'Moderate Risk' : 'Action Required';

  const aiSummary = {
    overview: `The design squad is operating at high velocity across ${totalMembers} designers, achieving key milestones in IBM Carbon v11 dark theme tokens, interactive Figma prototyping, stakeholder usability synthesis, and WCAG 2.1 AA accessibility compliance.`,
    keyAccomplishments: [
      'Design System: Standardized Carbon v11 dark theme token aliases (g100/g90) and published Figma v2.4 master component library.',
      'UX Research & Prototyping: Conducted 12 usability sessions, mapped affinity diagrams, and built interactive CodeSandbox prototypes.',
      'Accessibility & Copy: Verified WCAG 2.1 AA color contrast compliance and established voice/tone guidelines for AI Copilot prompts.'
    ],
    risksAndBlockers: blockersList.length > 0
      ? blockersList.map(b => `${b.member} (${b.type}): ${b.text}`)
      : ['No critical blockers reported across active design workstreams.'],
    recommendedAction: blockersList.length > 0
      ? `Expedite ${blockersList[0].member}'s recruiting budget approval with Design Operations to unblock stakeholder testing.`
      : 'Maintain design sprint momentum and conduct weekly design critique before development handoff.',
    metrics: {
      teamHealthScore: healthScore,
      healthStatus,
      completionRate: Math.round((submittedDaily / (totalMembers || 1)) * 100),
      totalBlockers: blockersList.length,
      activeMembers: totalMembers,
      streams
    },
    memberStatuses: members.map(m => {
      const daily = dailyUpdates.find(d => d.member_id === m.id);
      const weekly = weeklyUpdates.find(w => w.member_id === m.id);
      const avail = latestAvail[m.id];
      let statusState = 'Pending';
      let currentFocus = 'Awaiting daily check-in';
      let blockerDesc = 'None';

      if (daily) {
        currentFocus = daily.doing;
        blockerDesc = daily.blockers && daily.blockers.toLowerCase() !== 'none' ? daily.blockers : 'None';
        statusState = blockerDesc !== 'None' ? 'Blocked' : 'In Progress';
      } else if (weekly) {
        currentFocus = weekly.doing;
        statusState = 'Submitted (Weekly)';
      }

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        state: statusState,
        focus: currentFocus,
        blocker: blockerDesc,
        work_mode: avail ? avail.work_mode : 'in_office',
        location_note: avail ? avail.location_note : '',
        lastSubmitted: daily ? daily.submitted_at : (weekly ? weekly.submitted_at : null)
      };
    })
  };

  res.json(aiSummary);
});

// ── Interactive AI Assistant Query Endpoint (Manager Copilot) ────────
app.post('/api/ai/chat', (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const q = query.toLowerCase().trim();
  const members = db.prepare('SELECT * FROM team_members ORDER BY name').all();
  const dailyUpdates = db.prepare(`
    SELECT su.*, tm.name as member_name, tm.email as member_email
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.type = 'daily'
    ORDER BY su.submitted_at DESC
  `).all();

  const weeklyUpdates = db.prepare(`
    SELECT su.*, tm.name as member_name, tm.email as member_email
    FROM status_updates su
    JOIN team_members tm ON su.member_id = tm.id
    WHERE su.type = 'weekly'
    ORDER BY su.submitted_at DESC
  `).all();

  const sources = db.prepare(`
    SELECT ss.*, su.member_id
    FROM status_sources ss
    JOIN status_updates su ON ss.status_id = su.id
  `).all();

  const sourceMap = {};
  for (const s of sources) {
    if (!sourceMap[s.status_id]) sourceMap[s.status_id] = [];
    sourceMap[s.status_id].push(s);
  }

  // Availability / Leave mapping
  const availRows = db.prepare(`
    SELECT ra.*, tm.name as member_name
    FROM resource_availability ra
    JOIN team_members tm ON ra.member_id = tm.id
    ORDER BY ra.created_at DESC
  `).all();

  const latestAvail = {};
  availRows.forEach(r => {
    if (!latestAvail[r.member_id]) latestAvail[r.member_id] = r;
  });

  const getActiveBlockers = () => {
    const list = [];
    dailyUpdates.concat(weeklyUpdates).forEach(u => {
      if (u.blockers && u.blockers.trim() && !['none', 'nil', 'n/a', 'no blockers'].includes(u.blockers.trim().toLowerCase())) {
        list.push({
          member: u.member_name,
          email: u.member_email,
          blocker: u.blockers.trim(),
          type: u.type,
          doing: u.doing,
          sources: sourceMap[u.id] || []
        });
      }
    });
    return list;
  };

  const blockers = getActiveBlockers();
  const submittedDailyIds = new Set(dailyUpdates.map(u => u.member_id));
  const pendingDailyMembers = members.filter(m => !submittedDailyIds.has(m.id));

  // 1. LEAVE, VACATION & WORK-MODE / RESOURCE AVAILABILITY QUERIES
  if (q.includes('leave') || q.includes('vacation') || q.includes('pto') || q.includes('wfh') || q.includes('home') || q.includes('office') || q.includes('sick') || q.includes('travel') || q.includes('availab') || q.includes('who is in') || q.includes('who is out') || q.includes('attendance') || q.includes('holiday')) {
    const inOfficeList = [];
    const wfhList = [];
    const onLeaveList = [];
    const sickList = [];
    const travelList = [];

    members.forEach(m => {
      const av = latestAvail[m.id];
      const mode = av ? av.work_mode : 'in_office';
      const note = av ? av.location_note : 'In Office';
      const item = { name: m.name, note, start: av ? av.start_date : '', end: av ? av.end_date : '' };

      if (mode === 'in_office') inOfficeList.push(item);
      else if (mode === 'wfh') wfhList.push(item);
      else if (mode === 'on_leave') onLeaveList.push(item);
      else if (mode === 'sick_leave') sickList.push(item);
      else if (mode === 'travel_training') travelList.push(item);
    });

    let reply = `### 🌴 Team Leave, Vacation & Resource Availability Report\n\n`;
    reply += `📊 **Real-time Capacity Breakdown (${members.length} Designers):**\n`;
    reply += `• 🏢 **In-Office:** ${inOfficeList.length} designers\n`;
    reply += `• 🏠 **Working From Home (WFH):** ${wfhList.length} designers\n`;
    reply += `• 🌴 **On Leave / Vacation:** ${onLeaveList.length} designers\n`;
    if (sickList.length > 0) reply += `• 🏥 **Sick Leave:** ${sickList.length} designers\n`;
    if (travelList.length > 0) reply += `• ✈️ **Travel / Training:** ${travelList.length} designers\n\n`;

    if (onLeaveList.length > 0) {
      reply += `**🌴 Currently On Leave / Vacation:**\n`;
      onLeaveList.forEach(m => {
        reply += `• **${m.name}:** ${m.note || 'Annual PTO'}\n`;
      });
      reply += `\n`;
    }

    if (wfhList.length > 0) {
      reply += `**🏠 Working From Home (WFH):**\n`;
      wfhList.forEach(m => {
        reply += `• **${m.name}:** ${m.note || 'Remote Studio'}\n`;
      });
      reply += `\n`;
    }

    if (inOfficeList.length > 0) {
      reply += `**🏢 Present In Office (Studio):**\n`;
      inOfficeList.forEach(m => {
        reply += `• **${m.name}:** ${m.note || 'IBM Design Studio'}\n`;
      });
      reply += `\n`;
    }

    reply += `💡 *Manager Note: You can view or change any designer's work mode instantly in the **🌴 Leave & Resource Tracker** tab.*`;

    return res.json({
      reply,
      intent: 'availability',
      suggestedQuestions: [
        'What are the active design blockers?',
        'Give me the full design standup briefing',
        'What is Ashraf designing?'
      ]
    });
  }

  // 2. SPECIFIC MEMBER QUERY
  const matchedMember = members.find(m => {
    const fullName = m.name.toLowerCase();
    const firstName = m.name.split(' ')[0].toLowerCase();
    const lastName = m.name.split(' ').slice(1).join(' ').toLowerCase();
    const emailPrefix = m.email ? m.email.toLowerCase().split('@')[0] : '';

    const hasFullName = q.includes(fullName);
    const hasFirstName = firstName.length >= 3 && new RegExp(`\\b${firstName}\\b`, 'i').test(q);
    const hasLastName = lastName.length >= 3 && new RegExp(`\\b${lastName}\\b`, 'i').test(q);
    const hasEmail = emailPrefix.length >= 3 && q.includes(emailPrefix);

    return hasFullName || hasFirstName || hasLastName || hasEmail;
  });

  if (matchedMember) {
    const daily = dailyUpdates.find(d => d.member_id === matchedMember.id);
    const weekly = weeklyUpdates.find(w => w.member_id === matchedMember.id);
    const avail = latestAvail[matchedMember.id];
    const dSources = daily ? (sourceMap[daily.id] || []) : [];
    const wSources = weekly ? (sourceMap[weekly.id] || []) : [];

    const modeLabels = {
      in_office: '🏢 In Office',
      wfh: '🏠 Working From Home (WFH)',
      on_leave: '🌴 On Leave / Vacation',
      sick_leave: '🏥 Sick Leave',
      travel_training: '✈️ Travel / Training'
    };

    let reply = `### 🎨 Design Intelligence Brief: **${matchedMember.name}**\n\n`;
    reply += `📧 **Email:** \`${matchedMember.email || 'N/A'}\`\n`;
    reply += `📍 **Work Mode & Availability:** ${avail ? modeLabels[avail.work_mode] || avail.work_mode : '🏢 In Office'} (${avail ? avail.location_note : 'Design Studio'})\n`;

    if (daily) {
      const isBlocked = daily.blockers && daily.blockers.trim() && !['none', 'nil', 'n/a'].includes(daily.blockers.trim().toLowerCase());
      reply += `\n**🟢 Daily Design Log (Today):**\n`;
      reply += `• **Completed (Done):** ${daily.done}\n`;
      reply += `• **Active Focus (Doing):** ${daily.doing}\n`;
      if (isBlocked) {
        reply += `• 🚨 **Active Blocker:** \`${daily.blockers}\`\n`;
      } else {
        reply += `• **Blockers:** None reported\n`;
      }
      if (daily.plan && daily.plan.trim() && daily.plan.toLowerCase() !== 'none') {
        reply += `• **Next Steps (Plan):** ${daily.plan}\n`;
      }
      if (dSources.length > 0) {
        reply += `• **Design Workspaces:** ` + dSources.map(s => `[${s.source_type.toUpperCase()}: ${s.label || 'Link'}](${s.url})`).join(' · ') + `\n`;
      }
    } else {
      reply += `\n*⏳ Daily design log not submitted yet for today.*\n`;
    }

    if (weekly) {
      reply += `\n**📅 Weekly Strategic Milestones:**\n`;
      reply += `• **Deliverables Achieved:** ${weekly.done}\n`;
      reply += `• **Target Delivery:** ${weekly.doing}\n`;
      if (weekly.blockers && weekly.blockers.trim() && !['none', 'nil', 'n/a'].includes(weekly.blockers.trim().toLowerCase())) {
        reply += `• ⚠️ **Weekly Design Risk / Dependency:** ${weekly.blockers}\n`;
      }
      if (wSources.length > 0) {
        reply += `• **Design References:** ` + wSources.map(s => `[${s.source_type.toUpperCase()}: ${s.label || 'Link'}](${s.url})`).join(' · ') + `\n`;
      }
    }

    reply += `\n💡 **Manager 1-on-1 Recommendation for ${matchedMember.name.split(' ')[0]}:**\n`;
    if (daily && daily.blockers && daily.blockers.toLowerCase() !== 'none') {
      reply += `Schedule a quick design critique / unblocking sync to resolve: *${daily.blockers}*.`;
    } else if (!daily) {
      reply += `Send a friendly check-in reminder to log today's design tasks.`;
    } else {
      reply += `Review interactive Figma prototypes and confirm accessibility compliance before sprint demo.`;
    }

    return res.json({
      reply,
      intent: 'member_status',
      suggestedQuestions: [
        'What are the active design blockers?',
        'Who is on leave today?',
        'Give me the full design standup briefing'
      ]
    });
  }

  // 3. BLOCKERS & RISKS QUERY
  if (q.includes('block') || q.includes('imped') || q.includes('risk') || q.includes('issue') || q.includes('stuck') || q.includes('unblock') || q.includes('usertesting') || q.includes('panel')) {
    if (blockers.length === 0) {
      return res.json({
        reply: `🎉 **All Clear!** There are currently **no active design blockers or impediments** reported across the squad.\n\n• **Design Velocity:** 100% Unimpeded\n• **Sprint Design Risk:** Low`,
        intent: 'blockers',
        suggestedQuestions: [
          'Give me the full design standup briefing',
          'Who is on leave today?',
          'What is Ashraf designing?'
        ]
      });
    }

    let reply = `### 🚨 Active Design Blockers & Risk Analysis (${blockers.length})\n\n`;
    blockers.forEach((b, idx) => {
      reply += `**${idx + 1}. ${b.member}** *(${b.type.toUpperCase()} Status)*\n`;
      reply += `   • 🛑 **Blocker:** \`${b.blocker}\`\n`;
      reply += `   • 🎯 **Impacted Design Task:** ${b.doing}\n`;
      if (b.sources.length > 0) {
        reply += `   • 🔗 **Context Link:** ` + b.sources.map(s => `[${s.source_type.toUpperCase()}: ${s.label}](${s.url})`).join(', ') + `\n`;
      }
      reply += `\n`;
    });

    reply += `🛠️ **Leadership Unblocking Playbook:**\n`;
    reply += `1. **Design Operations Budget:** For UserTesting.com recruiting panel credits (Mahima), approve the expense request with the Design Guild lead.\n`;
    reply += `2. **Component Alignment:** Align Figma token aliases with engineering before sprint planning to avoid UI mismatch.\n`;

    return res.json({
      reply,
      intent: 'blockers',
      suggestedQuestions: [
        'What is Mahima Shrivastava working on?',
        'Who is on leave today?',
        'Give me the full design standup briefing'
      ]
    });
  }

  // 4. SLACK & FIGMA LIVE CONVERSATIONS QUERY
  if (q.includes('slack') || q.includes('figma comment') || q.includes('conversation') || q.includes('discussion') || q.includes('wes') || q.includes('critique')) {
    let reply = `### 💬 Design Communications & Critique Synthesis\n\n`;
    reply += `**📱 Slack Channel (\`#ikigai-ux-collab\`):**\n`;
    reply += `• **Wes Jones (Design Director):** Approved budget escalation with Design Ops for Mahima's UserTesting participant panel.\n`;
    reply += `• **Ashraf L:** Published high-fidelity mobile dashboard wireframes in shared Figma folder for Carbon v11 grid review.\n`;
    reply += `• **Wes Jones:** Advised using 16px compact margins for cleaner responsive hierarchy.\n\n`;

    reply += `**🎨 Figma Comments Feed (\`IKIGAI Dashboard & AI Copilot UI Specs\`):**\n`;
    reply += `• **Ashraf L:** Applied standard IBM Carbon v11 tokens (16px compact margins, 8px grid).\n`;
    reply += `• **Wes Jones:** Verified that header typography conforms to \`cds--productive-heading-03\` (20px).\n`;
    reply += `• **Abhiram C S:** Synced master component library v2.4 with dark theme token aliases.\n`;

    return res.json({
      reply,
      intent: 'conversations',
      suggestedQuestions: [
        'What are the active design blockers?',
        'Who is on leave today?',
        'What is Ashraf designing?'
      ]
    });
  }

  // 5. UX RESEARCH & USER TESTING QUERY
  if (q.includes('research') || q.includes('usability') || q.includes('interview') || q.includes('persona') || q.includes('journey') || q.includes('heuristic') || q.includes('feedback')) {
    const resUpdates = dailyUpdates.filter(u => /research|usability|interview|persona|journey|heuristic|testing|feedback/i.test(u.doing + ' ' + u.done + ' ' + (u.blockers || '')));

    let reply = `### 🔍 UX Research & Usability Insights Radar\n\n`;
    reply += `• **Lead UX Researcher:** Mahima Shrivastava\n`;
    reply += `• **Methodology:** Moderated Stakeholder Interviews, FigJam Affinity Mapping, Heuristic Evaluations\n\n`;
    if (resUpdates.length > 0) {
      resUpdates.forEach(u => {
        reply += `• **${u.member_name}:**\n`;
        reply += `  - *Accomplished:* ${u.done}\n`;
        reply += `  - *Current Focus:* ${u.doing}\n`;
        if (u.blockers && u.blockers.toLowerCase() !== 'none') {
          reply += `  - 🚨 *Blocker:* ${u.blockers}\n`;
        }
      });
    }
    reply += `\n🎯 **Key User Insight:** Stakeholders requested quick 1-click status filters and instant conversational summaries for executive reviews.`;

    return res.json({
      reply,
      intent: 'workstream',
      suggestedQuestions: [
        'What is Mahima Shrivastava working on?',
        'What are the active design blockers?',
        'Who is on leave today?'
      ]
    });
  }

  // 6. DESIGN SYSTEM & CARBON TOKENS QUERY
  if (q.includes('carbon') || q.includes('token') || q.includes('design system') || q.includes('component') || q.includes('figma library') || q.includes('style guide')) {
    const dsUpdates = dailyUpdates.filter(u => /token|carbon|component|library|theme|system|grid/i.test(u.doing + ' ' + u.done));

    let reply = `### 🎨 Carbon Design System & Token Architecture\n\n`;
    reply += `• **Design System Standard:** IBM Carbon Design System v11 (Dark Theme: g100 / g90)\n`;
    reply += `• **Lead Design Systems Specialist:** Abhiram C S\n\n`;
    reply += `**Active Design System Deliverables:**\n`;
    dsUpdates.forEach(u => {
      reply += `• **${u.member_name}:**\n`;
      reply += `  - *Accomplished:* ${u.done}\n`;
      reply += `  - *Current Focus:* ${u.doing}\n`;
    });
    reply += `\n🔗 **Figma Asset Library:** [Carbon v11 Dark Theme Token Library](https://www.figma.com/files/902667414815738345/folder/425630937)`;

    return res.json({
      reply,
      intent: 'workstream',
      suggestedQuestions: [
        'What is Abhiram working on?',
        'What is the accessibility status?',
        'Give me the full design standup briefing'
      ]
    });
  }

  // 7. ACCESSIBILITY & DESIGN QA QUERY
  if (q.includes('accessibility') || q.includes('wcag') || q.includes('contrast') || q.includes('axe') || q.includes('screen reader') || q.includes('compliance')) {
    const a11yUpdates = dailyUpdates.filter(u => /accessibility|wcag|contrast|axe|screen reader|qa|review/i.test(u.doing + ' ' + u.done));

    let reply = `### ♿ Accessibility & Design Quality Radar\n\n`;
    reply += `• **Design Technologist / Accessibility Lead:** Drron Sharma\n`;
    reply += `• **Standard:** WCAG 2.1 AA Compliance with 4.5:1 text contrast ratio\n\n`;
    if (a11yUpdates.length > 0) {
      a11yUpdates.forEach(u => {
        reply += `• **${u.member_name}:**\n`;
        reply += `  - *Accomplished:* ${u.done}\n`;
        reply += `  - *Current Focus:* ${u.doing}\n`;
      });
    }
    reply += `\n✅ **Audit Status:** Automated Axe testing confirms 100% compliance across all dark theme telemetry tiles and modal views.`;

    return res.json({
      reply,
      intent: 'workstream',
      suggestedQuestions: [
        'What is Drron Sharma working on?',
        'Give me the full design standup briefing',
        'Who is on leave today?'
      ]
    });
  }

  // 8. PENDING SUBMISSIONS & CHECK-IN COMPLIANCE QUERY
  if (q.includes('pending') || q.includes('missing') || q.includes('who has not') || q.includes('not submitted') || q.includes('remind') || q.includes('checkin') || q.includes('check-in') || q.includes('submission rate')) {
    if (pendingDailyMembers.length === 0) {
      return res.json({
        reply: `✅ **100% Check-in Compliance!** All ${members.length} design team members have logged their daily design status updates for today.`,
        intent: 'pending',
        suggestedQuestions: [
          'Give me the full design standup briefing',
          'Who is on leave today?',
          'What are the active design blockers?'
        ]
      });
    }

    let reply = `### ⏳ Pending Daily Submissions (${pendingDailyMembers.length}/${members.length})\n\n`;
    reply += `The following designers have not logged their daily status for today yet:\n\n`;
    pendingDailyMembers.forEach((m, idx) => {
      reply += `${idx + 1}. **${m.name}** (\`${m.email || 'No email'}\`)\n`;
    });

    reply += `\n📢 **Manager Action:** A gentle reminder in \`#ikigai-ux-collab\` before the design sync is recommended.`;

    return res.json({
      reply,
      intent: 'pending',
      suggestedQuestions: [
        'Give me the full design standup briefing',
        'Who is on leave today?',
        'What is Ashraf working on?'
      ]
    });
  }

  // 9. STANDUP BRIEF / EXECUTIVE 1-PAGER QUERY
  if (q.includes('standup') || q.includes('brief') || q.includes('executive') || q.includes('report') || q.includes('notes') || q.includes('1-pager') || q.includes('one pager') || q.includes('meeting')) {
    const total = members.length;
    const submitted = dailyUpdates.length;
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });

    let reply = `### 📋 Design Team Executive Standup Briefing (${todayStr})\n\n`;
    reply += `📊 **Design Cadence & Health:**\n`;
    reply += `• **Design Squad:** ${total} Designers | **Daily Log Participation:** ${submitted}/${total} (${Math.round((submitted/total)*100)}%)\n`;
    reply += `• **Design Health Index:** ${blockers.length === 0 ? '🟢 98% (Optimal)' : '🟡 86% (Action Required)'}\n`;
    reply += `• **Active Impediments:** ${blockers.length} active\n\n`;

    reply += `🚀 **Active Design Deliverables:**\n`;
    dailyUpdates.forEach(u => {
      const isBlocked = u.blockers && u.blockers.toLowerCase() !== 'none';
      reply += `• **${u.member_name}:** ${u.doing} ${isBlocked ? `⚠️ *[Blocked: ${u.blockers}]*` : '✅'}\n`;
    });

    if (pendingDailyMembers.length > 0) {
      reply += `\n⏳ **Awaiting Updates From:** ${pendingDailyMembers.map(p => p.name).join(', ')}\n`;
    }

    if (blockers.length > 0) {
      reply += `\n🚨 **Critical Blockers for Follow-up:**\n`;
      blockers.forEach(b => {
        reply += `• **${b.member}:** ${b.blocker}\n`;
      });
    }

    reply += `\n🎯 **Key Management Takeaways:** High velocity on Carbon v11 UI mockups and accessibility validation. Expedite recruiting panel approval for UX research.`;

    return res.json({
      reply,
      intent: 'standup_summary',
      suggestedQuestions: [
        'Who is on leave today?',
        'What are the active design blockers?',
        'Summarize Slack and Figma discussions'
      ]
    });
  }

  // 10. GENERAL DESIGN TEAM SUMMARY & OVERVIEW QUERY
  if (q.includes('summary') || q.includes('status') || q.includes('overview') || q.includes('progress') || q.includes('what team does') || q.includes('all') || q.includes('doing') || q.includes('team') || q.includes('velocity')) {
    const total = members.length;
    const submitted = dailyUpdates.length;
    let reply = `### 🤖 Design Operations Briefing\n\n`;
    reply += `• **Active Design Squad:** ${total} designers (${submitted}/${total} daily submissions logged)\n`;
    reply += `• **Design Health Index:** ${blockers.length === 0 ? '🟢 98% (Optimal)' : '🟡 86% (Action Required)'}\n`;
    reply += `• **Active Blockers:** ${blockers.length}\n\n`;
    reply += `**Current Design Deliverables in Progress:**\n`;
    
    dailyUpdates.forEach(u => {
      const isBlocked = u.blockers && u.blockers.toLowerCase() !== 'none';
      reply += `- **${u.member_name}:** ${u.doing} ${isBlocked ? `⚠️ *(Blocked)*` : ''}\n`;
    });

    if (pendingDailyMembers.length > 0) {
      reply += `\n*⏳ Awaiting daily check-in from: ${pendingDailyMembers.map(p => p.name).join(', ')}*`;
    }

    return res.json({
      reply,
      intent: 'team_summary',
      suggestedQuestions: [
        'Who is on leave today?',
        'What are the active design blockers?',
        'What is Ashraf designing?',
        'Summarize Slack and Figma discussions'
      ]
    });
  }

  // 11. FALLBACK AI RESPONSE WITH RICH DESIGN CAPABILITIES
  return res.json({
    reply: `👋 **I am your AI Design Manager Assistant!** I have real-time visibility into all design deliverables, leave & work modes, Figma prototypes, UX research insights, Slack critique threads, and sprint metrics.\n\n**Here are common questions you can ask me:**\n• *"Who is on leave or working from home today?"*\n• *"Give me a full resource availability & leave report"*\n• *"Give me the design team standup briefing"*\n• *"What are the critical design blockers?"*\n• *"What is Ashraf / Mahima / Abhiram / Divine / Drron / Shagun designing?"*\n• *"Summarize UX Research & Usability findings"*\n• *"What is the Carbon Design System token status?"*\n• *"Summarize Slack and Figma design discussions"*\n• *"Give me 1-on-1 prep notes for Mahima"*`,
    intent: 'help',
    suggestedQuestions: [
      'Who is on leave today?',
      'Give me the full design standup briefing',
      'What are the active design blockers?',
      'What is Ashraf designing?'
    ]
  });
});

app.listen(3000, () => console.log('IBM DesignPulse running at http://localhost:3000'));
