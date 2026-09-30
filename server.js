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
    res.json({ id: info.lastInsertRowid, name, email });
  } catch (e) {
    res.status(400).json({ error: 'Member already exists' });
  }
});

app.delete('/api/members/:id', (req, res) => {
  db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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
    // If back-dating, format it nicely or pass as-is. If they provide YYYY-MM-DD, we can append a default time or let SQLite interpret it.
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
  // Find Monday of current or requested week
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

// ── Live Slack Channel Stream (Mock) ─────────────────────────
app.get('/api/slack/live', (req, res) => {
  const now = new Date();
  
  // Dynamically generate timestamps relative to current system time
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
      text: 'Thanks Mahima, I see your weekly blocker regarding the staging VPC access. I\'ve just initiated an escalation thread with the Cloud Operations team. Hopefully, we\'ll get you unblocked by today afternoon.',
      time: formatTime(8)
    },
    {
      id: 2,
      channel: '#ikigai-ux-collab',
      user: 'Ashraf L',
      username: '@ashraf',
      avatar: 'AL',
      text: 'Great work Wes, thank you! I just uploaded the high-fidelity mockups for the mobile dashboard layout in the shared Figma Folder. @wes_jones would love to get your feedback on the Carbon v11 grid alignment for the compact view.',
      time: formatTime(25)
    },
    {
      id: 3,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones',
      username: '@wes_jones',
      avatar: 'WJ',
      text: '@ashraf I reviewed the mockups! The spacing looks excellent overall, but on the compact screen, let\'s make sure we utilize the 16px border-margins instead of 24px. It\'ll give the lists a bit more breathing room.',
      time: formatTime(40)
    },
    {
      id: 4,
      channel: '#ikigai-ux-collab',
      user: 'Divine Antony',
      username: '@divine_antony',
      avatar: 'DA',
      text: 'Update on backend: I\'ve successfully mapped all SQLite SQL relations for status history. @abhiram.cs I pushed the schema optimizations, can you review the load times on the timeline endpoint?',
      time: formatTime(75)
    },
    {
      id: 5,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones',
      username: '@wes_jones',
      avatar: 'WJ',
      text: 'Superb stuff, Divine! Storing historical status changes in SQLite is a game changer. Can we verify we have indices on `status_id` and `submitted_at`? That will prevent performance bottlenecks as the volume of submissions grows over the quarters.',
      time: formatTime(90)
    },
    {
      id: 6,
      channel: '#ikigai-alerts',
      user: 'Mahima Shrivastava',
      username: '@mahima',
      avatar: 'MS',
      text: '🚨 ALERT: Successfully resolved 4 critical CVE alerts on our dependency libraries. Regression build has been triggered on our automation test nodes.',
      time: formatTime(120)
    }
  ];

  res.json({
    channel: '#ikigai-ux-collab',
    topic: 'IKIGAI Design Alignment & Code Integrations',
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

  // Slack Messages Feed
  const slackStream = [
    {
      id: 1,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones',
      username: '@wes_jones',
      avatar: 'WJ',
      text: 'Thanks Mahima, I see your weekly blocker regarding the staging VPC access. I\'ve just initiated an escalation thread with the Cloud Operations team. Hopefully, we\'ll get you unblocked by today afternoon.',
      time: formatTime(8)
    },
    {
      id: 2,
      channel: '#ikigai-ux-collab',
      user: 'Ashraf L',
      username: '@ashraf',
      avatar: 'AL',
      text: 'Great work Wes, thank you! I just uploaded the high-fidelity mockups for the mobile dashboard layout in the shared Figma Folder. @wes_jones would love to get your feedback on the Carbon v11 grid alignment for the compact view.',
      time: formatTime(25)
    },
    {
      id: 3,
      channel: '#ikigai-ux-collab',
      user: 'Wes Jones',
      username: '@wes_jones',
      avatar: 'WJ',
      text: '@ashraf I reviewed the mockups! The spacing looks excellent overall, but on the compact screen, let\'s make sure we utilize the 16px border-margins instead of 24px. It\'ll give the lists a bit more breathing room.',
      time: formatTime(40)
    }
  ];

  // Figma Comment Feed
  const figmaStream = [
    {
      id: 1,
      file: 'IKIGAI Dashboard Mobile Layout',
      user: 'Ashraf L',
      username: '@ashraf',
      text: 'Applied the IBM Carbon v11 spacing guidelines (16px compact margins, 8px layout grid). Updated design layers to reflect standard tokens.',
      time: formatTime(15)
    },
    {
      id: 2,
      file: 'IKIGAI Dashboard Mobile Layout',
      user: 'Wes Jones',
      username: '@wes_jones',
      text: 'Looks correct, Ashraf. Let\'s verify the header text size uses the standard `cds--productive-heading-03` (20px) to ensure typographic consistency with our backend data headers.',
      time: formatTime(10)
    },
    {
      id: 3,
      file: 'IKIGAI Dashboard Mobile Layout',
      user: 'Shagun Bajpai',
      username: '@shagun',
      text: 'Added visual regression automation test cases for compact viewport widths matching this specification.',
      time: formatTime(5)
    }
  ];

  res.json({
    slack: {
      channel: '#ikigai-ux-collab',
      messages: slackStream
    },
    figma: {
      file: 'IKIGAI Dashboard Mobile Layout',
      comments: figmaStream
    }
  });
});

// ── Live Boxnote Polling Sync Service (Mock Emulator) ────────
const syncLogs = [];
let logIdCounter = 1;

// Seed some initial sync logs
syncLogs.push({
  id: logIdCounter++,
  user: 'System',
  message: 'Live Boxnote Sync Engine initialized successfully. Listening for Boxnote revisions...',
  time: new Date().toLocaleTimeString()
});

// Mock database changes triggered by Boxnote edits
const boxnoteEditsPool = [
  {
    email: 'abhiram.cs@ibm.com',
    done: 'Optimized user authentication middleware and ran unit tests. Fixed memory leaks in DB pooling.',
    doing: 'Refactoring route endpoints and assisting Shagun with selenium test cases.',
    message: 'Abhiram C S updated Boxnote Daily Tasks'
  },
  {
    email: 'Ashraf.L@ibm.com',
    done: 'Reviewed IKIGAI mobile and desktop layouts, updated 4 core elements in Figma Workspace.',
    doing: 'Iterating on compact layout spacings (applying Carbon 16px border-margins rule).',
    message: 'Ashraf L typed in Boxnote Daily Tasks'
  },
  {
    email: 'divineantony@ibm.com',
    done: 'Mapped SQLite relations for history endpoint, set performance indices on status_id.',
    doing: 'Troubleshooting history payload rendering delays.',
    message: 'Divine Antony edited Boxnote Daily Tasks'
  },
  {
    email: 'Mahima Shrivastava',
    done: 'Conducted security scans, resolved critical CVE dependency warnings.',
    doing: 'Configuring firewall parameters and verifying staging credentials.',
    message: 'Mahima Shrivastava modified Boxnote Weekly Goals'
  },
  {
    email: 'Shagun.Bajpai@ibm.com',
    done: 'Created visual regression scripts for automated viewport width checks.',
    doing: 'Integrating selenium assertions to match Carbon typography guidelines.',
    message: 'Shagun Bajpai typed in Boxnote Weekly Goals'
  }
];

let editPoolIndex = 0;

// Poll/Simulate a Boxnote update event every 25 seconds
setInterval(() => {
  const edit = boxnoteEditsPool[editPoolIndex];
  editPoolIndex = (editPoolIndex + 1) % boxnoteEditsPool.length;

  try {
    const member = db.prepare('SELECT * FROM team_members WHERE email = ? OR name = ?').get(edit.email, edit.email);
    if (member) {
      // Find latest update for this member or insert a new one
      const lastUpdate = db.prepare('SELECT id FROM status_updates WHERE member_id = ? ORDER BY submitted_at DESC LIMIT 1').get(member.id);
      
      if (lastUpdate) {
        // Simulating the user typing in the Boxnote and updating their status board record instantly!
        db.prepare(`
          UPDATE status_updates
          SET done = ?, doing = ?, submitted_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(edit.done, edit.doing, lastUpdate.id);
      } else {
        db.prepare(`
          INSERT INTO status_updates (member_id, type, done, doing, blockers, plan)
          VALUES (?, 'daily', ?, ?, 'None', 'Continue tracking edits')
        `).run(member.id, edit.done, edit.doing);
      }

      const log = {
        id: logIdCounter++,
        user: member.name,
        message: `${edit.message}: Updated 'Done' & 'Doing' tasks in real-time. Status Board auto-refreshed.`,
        time: new Date().toLocaleTimeString()
      };

      syncLogs.push(log);
      if (syncLogs.length > 30) syncLogs.shift(); // Keep latest 30 logs
    }
  } catch (err) {
    console.error('Boxnote Sync Emulator Error:', err.message);
  }
}, 25000); // Triggers every 25 seconds

// GET Boxnote Sync Logs
app.get('/api/boxnotes/sync-logs', (req, res) => {
  res.json({
    active: true,
    provider: 'IBM Boxnotes Real-time Sync',
    logs: syncLogs
  });
});

app.listen(3000, () => console.log('Team Status Board running at http://localhost:3000'));
