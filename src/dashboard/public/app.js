// Sheep Dashboard — Client
const API = '';

// --- State ---
let currentMemoryFile = null;

// --- Helpers ---
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(str, len = 60) {
  if (!str) return '-';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Tabs ---
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');

    // Load data for the tab
    const tab = btn.dataset.tab;
    if (tab === 'overview') loadStatus();
    if (tab === 'tasks') loadTasks();
    if (tab === 'memory') loadMemory();
    if (tab === 'conversations') loadConversations();
  });
});

// --- Overview ---
async function loadStatus() {
  try {
    const data = await api('/api/status');
    $('#status-badge').textContent = 'online';
    $('#status-badge').className = 'badge online';
    $('#uptime').textContent = `uptime: ${formatUptime(data.uptime)}`;
    $('#timezone').textContent = data.timezone;

    $('#stat-groups').textContent = data.groups.length;
    $('#stat-active-tasks').textContent = data.tasks.active;
    $('#stat-paused-tasks').textContent = data.tasks.paused;
    $('#stat-uptime').textContent = formatUptime(data.uptime);

    const tbody = $('#groups-table tbody');
    tbody.innerHTML = '';
    for (const g of data.groups) {
      const jidPrefix = g.jid.split(':')[0];
      const channel = jidPrefix === 'dc' ? 'Discord' : jidPrefix === 'tg' ? 'Telegram' : 'Other';
      tbody.innerHTML += `
        <tr>
          <td>${escapeHtml(g.name)}</td>
          <td>${channel}</td>
          <td><code>${escapeHtml(g.folder)}</code></td>
          <td>${g.requiresTrigger ? '@Sheep' : 'all messages'}</td>
          <td>${g.isMain ? '<span class="status status-active">main</span>' : ''}</td>
        </tr>`;
    }
  } catch {
    $('#status-badge').textContent = 'offline';
    $('#status-badge').className = 'badge';
  }
}

// --- Tasks ---
async function loadTasks() {
  const tasks = await api('/api/tasks');
  const tbody = $('#tasks-table tbody');
  tbody.innerHTML = '';

  if (tasks.length === 0) {
    $('#tasks-table').style.display = 'none';
    $('#tasks-empty').style.display = 'block';
    return;
  }

  $('#tasks-table').style.display = '';
  $('#tasks-empty').style.display = 'none';

  for (const t of tasks) {
    const statusClass = `status-${t.status}`;
    tbody.innerHTML += `
      <tr>
        <td class="prompt-cell" title="${escapeHtml(t.prompt)}">${escapeHtml(truncate(t.prompt, 50))}</td>
        <td>${t.schedule_type}</td>
        <td><code>${escapeHtml(t.schedule_value)}</code></td>
        <td><span class="status ${statusClass}">${t.status}</span></td>
        <td>${formatDate(t.next_run)}</td>
        <td>${escapeHtml(truncate(t.last_result, 40))}</td>
        <td class="actions">
          ${t.status === 'active'
            ? `<button class="btn btn-sm" onclick="taskAction('${t.id}', 'paused')">Pause</button>`
            : t.status === 'paused'
              ? `<button class="btn btn-sm" onclick="taskAction('${t.id}', 'active')">Resume</button>`
              : ''}
          <button class="btn btn-sm btn-danger" onclick="taskDelete('${t.id}')">Delete</button>
        </td>
      </tr>`;
  }
}

async function taskAction(id, status) {
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  loadTasks();
}

async function taskDelete(id) {
  if (!confirm('Delete this scheduled task?')) return;
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  loadTasks();
}

// --- Memory ---
async function loadMemory() {
  const files = await api('/api/memory/discord_main');
  const grid = $('#memory-list');
  grid.innerHTML = '';

  for (const f of files) {
    const preview = f.content.split('\n').slice(0, 5).join('\n');
    const card = document.createElement('div');
    card.className = 'memory-card';
    card.innerHTML = `
      <div class="memory-card-name">${escapeHtml(f.name)}</div>
      <div class="memory-card-preview">${escapeHtml(preview)}</div>
      <div class="memory-card-meta">${(f.size / 1024).toFixed(1)} KB</div>`;
    card.addEventListener('click', () => openEditor(f.name, f.content));
    grid.appendChild(card);
  }
}

function openEditor(name, content) {
  currentMemoryFile = name;
  $('#editor-filename').textContent = name;
  $('#editor-textarea').value = content;
  $('#memory-editor').style.display = 'block';
}

window.closeEditor = function() {
  $('#memory-editor').style.display = 'none';
  currentMemoryFile = null;
};

window.saveMemory = async function() {
  if (!currentMemoryFile) return;
  await api('/api/memory/discord_main', {
    method: 'PUT',
    body: JSON.stringify({
      name: currentMemoryFile,
      content: $('#editor-textarea').value,
    }),
  });
  closeEditor();
  loadMemory();
};

// --- Conversations ---
async function loadConversations() {
  const convs = await api('/api/conversations/discord_main');
  const list = $('#conversations-list');
  list.innerHTML = '';

  if (convs.length === 0) {
    list.style.display = 'none';
    $('#conversations-empty').style.display = 'block';
    return;
  }

  list.style.display = '';
  $('#conversations-empty').style.display = 'none';

  for (const c of convs) {
    const item = document.createElement('div');
    item.className = 'conv-item';

    const title = c.name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    item.innerHTML = `
      <div class="conv-header">
        <span class="conv-name">${escapeHtml(title)}</span>
        <span class="conv-date">${formatDate(c.date)}</span>
      </div>
      <div class="conv-body">${escapeHtml(c.content)}</div>`;

    item.querySelector('.conv-header').addEventListener('click', () => {
      const body = item.querySelector('.conv-body');
      body.classList.toggle('open');
    });

    list.appendChild(item);
  }
}

// Make task functions globally accessible
window.taskAction = taskAction;
window.taskDelete = taskDelete;

// --- Power Controls ---
let shutdownConfirm = false;
let restartConfirm = false;

window.shutdownSheep = async function() {
  const btn = document.querySelector('.btn-shutdown');
  if (!shutdownConfirm) {
    shutdownConfirm = true;
    btn.textContent = 'Confirm?';
    btn.classList.add('confirming');
    setTimeout(() => { shutdownConfirm = false; btn.textContent = 'Shut Down'; btn.classList.remove('confirming'); }, 3000);
    return;
  }
  btn.textContent = 'Shutting down...';
  btn.classList.remove('confirming');
  await api('/api/shutdown', { method: 'POST' });
  $('#status-badge').textContent = 'offline';
  $('#status-badge').className = 'badge';
  btn.textContent = 'Offline';
  btn.disabled = true;
};

window.restartSheep = async function() {
  const btn = document.querySelector('.btn-restart');
  if (!restartConfirm) {
    restartConfirm = true;
    btn.textContent = 'Confirm?';
    btn.classList.add('confirming');
    setTimeout(() => { restartConfirm = false; btn.textContent = 'Restart'; btn.classList.remove('confirming'); }, 3000);
    return;
  }
  btn.textContent = 'Restarting...';
  btn.classList.remove('confirming');
  await api('/api/restart', { method: 'POST' });
  $('#status-badge').textContent = 'restarting...';
  $('#status-badge').className = 'badge';
  // Poll until back up
  const poll = setInterval(async () => {
    try {
      const r = await fetch('/api/status');
      if (r.ok) {
        clearInterval(poll);
        btn.textContent = 'Restart';
        restartConfirm = false;
        loadStatus();
      }
    } catch {}
  }, 2000);
};

// --- Init ---
loadStatus();

// Auto-refresh status every 30s
setInterval(loadStatus, 30000);
