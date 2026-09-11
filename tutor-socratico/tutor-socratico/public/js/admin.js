// public/js/admin.js
// Panel docente: login simple, listado de sesiones, detalle de conversación
// y evaluación cualitativa de creatividad matemática por sesión.

let adminPassword = null;
let allSessions = [];
let currentSessionId = null;

const loginCard = document.getElementById('loginCard');
const panel = document.getElementById('panel');
const loginError = document.getElementById('loginError');
const listError = document.getElementById('listError');
const sessionsBody = document.getElementById('sessionsBody');
const detailWrap = document.getElementById('detailWrap');
const detailTitle = document.getElementById('detailTitle');
const detailMeta = document.getElementById('detailMeta');
const detailMessages = document.getElementById('detailMessages');
const searchInput = document.getElementById('searchInput');

function authHeaders() {
  return { 'x-admin-password': adminPassword };
}

async function login() {
  const password = document.getElementById('passwordInput').value;
  loginError.classList.add('hidden');
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Contraseña incorrecta.');
    adminPassword = password;
    sessionStorage.setItem('adminPassword', password);
    loginCard.classList.add('hidden');
    panel.classList.remove('hidden');
    loadSessions();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
}

async function loadSessions() {
  listError.classList.add('hidden');
  try {
    const res = await fetch('/api/admin/sessions', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error cargando sesiones.');
    allSessions = data;
    renderSessions(allSessions);
  } catch (err) {
    listError.textContent = err.message;
    listError.classList.remove('hidden');
  }
}

function renderSessions(sessions) {
  sessionsBody.innerHTML = '';
  if (sessions.length === 0) {
    sessionsBody.innerHTML = '<tr><td colspan="6" class="muted">Todavía no hay conversaciones registradas.</td></tr>';
    return;
  }
  for (const s of sessions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.student_name)}</td>
      <td>${escapeHtml(s.student_course)}</td>
      <td>${escapeHtml(s.topic || '—')}</td>
      <td>${s.message_count}</td>
      <td>${formatDate(s.started_at)}</td>
      <td><span class="status-pill ${s.status}">${s.status === 'active' ? 'activa' : 'finalizada'}</span></td>
    `;
    tr.addEventListener('click', () => openDetail(s.id));
    sessionsBody.appendChild(tr);
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('es-CO', {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch (_) {
    return iso;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function openDetail(sessionId) {
  currentSessionId = sessionId;
  const res = await fetch(`/api/admin/sessions/${sessionId}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) {
    listError.textContent = data.error || 'Error cargando la sesión.';
    listError.classList.remove('hidden');
    return;
  }

  detailTitle.textContent = `${data.student.name} · ${data.student.course}`;
  detailMeta.textContent = `Tema: ${data.session.topic || '(sin tema inicial)'} — Inicio: ${formatDate(data.session.started_at)}`;

  detailMessages.innerHTML = '';
  for (const m of data.messages) {
    const div = document.createElement('div');
    div.className = `bubble ${m.role}`;
    div.textContent = m.content;
    detailMessages.appendChild(div);
  }

  const notes = data.notes || {};
  document.getElementById('fluidez').value = notes.fluidez ?? '';
  document.getElementById('flexibilidad').value = notes.flexibilidad ?? '';
  document.getElementById('originalidad').value = notes.originalidad ?? '';
  document.getElementById('comentario').value = notes.comentario ?? '';
  document.getElementById('notesSaved').classList.add('hidden');

  detailWrap.classList.add('open');
  detailWrap.scrollIntoView({ behavior: 'smooth' });
}

async function saveNotes() {
  if (!currentSessionId) return;
  const body = {
    fluidez: document.getElementById('fluidez').value || null,
    flexibilidad: document.getElementById('flexibilidad').value || null,
    originalidad: document.getElementById('originalidad').value || null,
    comentario: document.getElementById('comentario').value || null,
  };
  const res = await fetch(`/api/admin/sessions/${currentSessionId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const saved = document.getElementById('notesSaved');
    saved.classList.remove('hidden');
    setTimeout(() => saved.classList.add('hidden'), 2000);
  }
}

function filterSessions() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return renderSessions(allSessions);
  renderSessions(
    allSessions.filter(
      (s) =>
        s.student_name.toLowerCase().includes(q) ||
        s.student_course.toLowerCase().includes(q) ||
        (s.topic || '').toLowerCase().includes(q)
    )
  );
}

document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('passwordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('closeDetail').addEventListener('click', () => detailWrap.classList.remove('open'));
document.getElementById('saveNotes').addEventListener('click', saveNotes);
searchInput.addEventListener('input', filterSessions);

document.getElementById('exportCsv').addEventListener('click', (e) => {
  e.preventDefault();
  downloadWithAuth('/api/admin/export.csv', 'conversaciones_tutor_socratico.csv');
});
document.getElementById('exportJson').addEventListener('click', (e) => {
  e.preventDefault();
  downloadWithAuth('/api/admin/export.json', 'conversaciones_tutor_socratico.json');
});

async function downloadWithAuth(url, filename) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    listError.textContent = 'No se pudo exportar.';
    listError.classList.remove('hidden');
    return;
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// =======================================================================
// Pestañas
// =======================================================================

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tabConversaciones').classList.toggle('hidden', tab !== 'conversaciones');
    document.getElementById('tabProblemas').classList.toggle('hidden', tab !== 'problemas');
    if (tab === 'problemas') loadProblems();
  });
});

// =======================================================================
// Banco de problemas
// =======================================================================

const problemsAdminList = document.getElementById('problemsAdminList');
const problemsListError = document.getElementById('problemsListError');
const problemFormError = document.getElementById('problemFormError');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const problemFormTitle = document.getElementById('problemFormTitle');
let editingProblemId = null;

async function loadProblems() {
  problemsListError.classList.add('hidden');
  try {
    const res = await fetch('/api/admin/problems', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error cargando problemas.');
    renderProblemsAdmin(data);
  } catch (err) {
    problemsListError.textContent = err.message;
    problemsListError.classList.remove('hidden');
  }
}

function renderProblemsAdmin(problems) {
  problemsAdminList.innerHTML = '';
  if (!problems.length) {
    problemsAdminList.innerHTML = '<p class="muted">Todavía no has publicado ningún problema.</p>';
    return;
  }
  for (const p of problems) {
    const div = document.createElement('div');
    div.className = `problem-item ${p.active ? '' : 'inactive'}`;
    div.innerHTML = `
      <div>
        <div class="p-title">${escapeHtml(p.title)}</div>
        <div class="p-meta">${p.grade ? escapeHtml(p.grade) + ' · ' : ''}${p.active ? 'activo (visible para estudiantes)' : 'inactivo (oculto)'}</div>
        <div class="p-statement">${escapeHtml(p.statement)}</div>
      </div>
      <div class="p-actions">
        <button data-action="edit">Editar</button>
        <button data-action="toggle">${p.active ? 'Desactivar' : 'Activar'}</button>
        <button data-action="delete">Eliminar</button>
      </div>
    `;
    div.querySelector('[data-action="edit"]').addEventListener('click', () => startEditProblem(p));
    div.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleProblem(p.id));
    div.querySelector('[data-action="delete"]').addEventListener('click', () => deleteProblem(p.id, p.title));
    problemsAdminList.appendChild(div);
  }
}

function startEditProblem(p) {
  editingProblemId = p.id;
  document.getElementById('pTitle').value = p.title;
  document.getElementById('pGrade').value = p.grade || '';
  document.getElementById('pStatement').value = p.statement;
  problemFormTitle.textContent = 'Editar problema';
  cancelEditBtn.classList.remove('hidden');
  document.getElementById('pTitle').scrollIntoView({ behavior: 'smooth' });
}

function resetProblemForm() {
  editingProblemId = null;
  document.getElementById('pTitle').value = '';
  document.getElementById('pGrade').value = '';
  document.getElementById('pStatement').value = '';
  problemFormTitle.textContent = 'Publicar un nuevo problema';
  cancelEditBtn.classList.add('hidden');
}

async function saveProblem() {
  const title = document.getElementById('pTitle').value.trim();
  const grade = document.getElementById('pGrade').value.trim();
  const statement = document.getElementById('pStatement').value.trim();
  problemFormError.classList.add('hidden');

  if (!title || !statement) {
    problemFormError.textContent = 'El problema necesita al menos título y enunciado.';
    problemFormError.classList.remove('hidden');
    return;
  }

  try {
    const url = editingProblemId ? `/api/admin/problems/${editingProblemId}` : '/api/admin/problems';
    const method = editingProblemId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title, grade, statement }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el problema.');
    resetProblemForm();
    loadProblems();
  } catch (err) {
    problemFormError.textContent = err.message;
    problemFormError.classList.remove('hidden');
  }
}

async function toggleProblem(id) {
  await fetch(`/api/admin/problems/${id}/toggle`, { method: 'POST', headers: authHeaders() });
  loadProblems();
}

async function deleteProblem(id, title) {
  if (!confirm(`¿Eliminar el problema "${title}"? Si ya fue usado en alguna conversación, se desactivará en vez de borrarse.`)) return;
  await fetch(`/api/admin/problems/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadProblems();
}

document.getElementById('saveProblemBtn').addEventListener('click', saveProblem);
cancelEditBtn.addEventListener('click', resetProblemForm);

// Reintentar sesión guardada en esta pestaña (no persiste entre dispositivos).
const saved = sessionStorage.getItem('adminPassword');
if (saved) {
  adminPassword = saved;
  fetch('/api/admin/sessions', { headers: authHeaders() }).then((res) => {
    if (res.ok) {
      loginCard.classList.add('hidden');
      panel.classList.remove('hidden');
      loadSessions();
    }
  });
}
