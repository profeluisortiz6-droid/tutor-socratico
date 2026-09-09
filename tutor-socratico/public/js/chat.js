// public/js/chat.js
// Lógica de la interfaz de estudiante: formulario de ingreso (con
// selección de un problema publicado por el docente) + chat.

const setupSection = document.getElementById('setup');
const chatSection = document.getElementById('chatSection');
const setupError = document.getElementById('setupError');
const chatError = document.getElementById('chatError');
const messagesEl = document.getElementById('messages');
const chatWho = document.getElementById('chatWho');
const composerInput = document.getElementById('composerInput');
const sendBtn = document.getElementById('sendBtn');
const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const problemsLoading = document.getElementById('problemsLoading');
const problemsEmpty = document.getElementById('problemsEmpty');
const problemListEl = document.getElementById('problemList');

let sessionId = null;
let sending = false;
let problems = [];
let selectedProblemId = null;

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}
function hideError(el) {
  el.classList.add('hidden');
}

function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function addThinkingBubble() {
  const div = document.createElement('div');
  div.className = 'bubble thinking';
  div.textContent = 'El tutor está pensando…';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function loadProblems() {
  try {
    const res = await fetch('/api/problems');
    problems = await res.json();
    problemsLoading.classList.add('hidden');
    if (!problems.length) {
      problemsEmpty.classList.remove('hidden');
      return;
    }
    problemListEl.classList.remove('hidden');
    renderProblems();
  } catch (err) {
    problemsLoading.classList.add('hidden');
    showError(setupError, 'No se pudieron cargar los problemas. Intenta recargar la página.');
  }
}

function renderProblems() {
  problemListEl.innerHTML = '';
  for (const p of problems) {
    const card = document.createElement('div');
    card.className = 'problem-card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="p-title">${escapeHtml(p.title)}${p.grade ? `<span class="p-grade">${escapeHtml(p.grade)}</span>` : ''}</div>
      <div class="p-statement">${escapeHtml(p.statement)}</div>
    `;
    card.addEventListener('click', () => selectProblem(p.id));
    problemListEl.appendChild(card);
  }
}

function selectProblem(id) {
  selectedProblemId = id;
  document.querySelectorAll('.problem-card').forEach((el) => {
    el.classList.toggle('selected', Number(el.dataset.id) === Number(id));
  });
  startBtn.disabled = false;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function startSession() {
  const name = document.getElementById('name').value.trim();
  const course = document.getElementById('course').value.trim();

  hideError(setupError);
  if (!name || !course) {
    showError(setupError, 'Por favor escribe tu nombre y tu curso.');
    return;
  }
  if (!selectedProblemId) {
    showError(setupError, 'Elige un problema para empezar.');
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = 'Iniciando…';

  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, course, problemId: selectedProblemId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar la sesión.');

    sessionId = data.sessionId;
    chatWho.textContent = `${name} · ${course} · ${data.problem.title}`;
    setupSection.classList.add('hidden');
    chatSection.classList.remove('hidden');

    addBubble('student', `Voy a trabajar: ${data.problem.title}`);
    addBubble('tutor', data.tutorReply);
    composerInput.focus();
  } catch (err) {
    showError(setupError, err.message);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = 'Empezar a conversar';
  }
}

async function sendMessage() {
  const text = composerInput.value.trim();
  if (!text || sending || !sessionId) return;

  hideError(chatError);
  sending = true;
  sendBtn.disabled = true;
  composerInput.value = '';
  addBubble('student', text);
  const thinking = addThinkingBubble();

  try {
    const res = await fetch(`/api/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    const data = await res.json();
    thinking.remove();
    if (!res.ok) throw new Error(data.error || 'Error obteniendo respuesta del tutor.');
    addBubble('tutor', data.tutorReply);
  } catch (err) {
    thinking.remove();
    showError(chatError, err.message);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    composerInput.focus();
  }
}

async function endSession() {
  if (!sessionId) return;
  try {
    await fetch(`/api/session/${sessionId}/end`, { method: 'POST' });
  } catch (_) {
    // no bloquear al estudiante si esto falla
  }
  addBubble('tutor', '¡Gracias por explorar conmigo hoy! Esta sesión ha finalizado. Puedes cerrar la página o recargarla para empezar una nueva.');
  composerInput.disabled = true;
  sendBtn.disabled = true;
  endBtn.disabled = true;
}

startBtn.addEventListener('click', startSession);
endBtn.addEventListener('click', endSession);
sendBtn.addEventListener('click', sendMessage);
composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
composerInput.addEventListener('input', () => {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(composerInput.scrollHeight, 140) + 'px';
});

loadProblems();
