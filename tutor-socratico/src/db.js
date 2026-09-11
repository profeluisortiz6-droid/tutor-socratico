// src/db.js
// Capa de acceso a la base de datos SQLite del Tutor Socrático.
// Se usa better-sqlite3: rápido, sincrónico y sin necesidad de un servidor
// de base de datos aparte — ideal para un despliegue sencillo en un
// servicio como Render/Railway o incluso en un servidor propio del colegio.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'tutor.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  course TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  grade TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  problem_id INTEGER REFERENCES problems(id),
  topic TEXT,
  initial_problem TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK (role IN ('student','tutor')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_notes (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  fluidez INTEGER,
  flexibilidad INTEGER,
  originalidad INTEGER,
  comentario TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
`);

// Migración simple para bases de datos creadas con una versión anterior
// del esquema (antes de que existiera la tabla "problems"): agrega la
// columna problem_id a "sessions" si todavía no existe.
const sessionColumns = db.prepare(`PRAGMA table_info(sessions)`).all();
if (!sessionColumns.some((c) => c.name === 'problem_id')) {
  db.exec(`ALTER TABLE sessions ADD COLUMN problem_id INTEGER REFERENCES problems(id)`);
}

// Migración: agrega la columna "images" a "problems" (lista de nombres de
// archivo, en JSON) para poder adjuntar imágenes (por ejemplo, gráficas
// hechas en PSTricks y exportadas como imagen) a un enunciado.
const problemColumns = db.prepare(`PRAGMA table_info(problems)`).all();
if (!problemColumns.some((c) => c.name === 'images')) {
  db.exec(`ALTER TABLE problems ADD COLUMN images TEXT NOT NULL DEFAULT '[]'`);
}

// ---- Consultas preparadas ----------------------------------------------

const stmts = {
  findStudent: db.prepare(
    `SELECT * FROM students WHERE name = ? AND course = ?`
  ),
  insertStudent: db.prepare(
    `INSERT INTO students (name, course) VALUES (?, ?)`
  ),
  insertSession: db.prepare(
    `INSERT INTO sessions (id, student_id, problem_id, topic, initial_problem) VALUES (?, ?, ?, ?, ?)`
  ),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  touchSession: db.prepare(
    `UPDATE sessions SET message_count = message_count + 1 WHERE id = ?`
  ),
  endSession: db.prepare(
    `UPDATE sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?`
  ),
  insertMessage: db.prepare(
    `INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)`
  ),
  getMessages: db.prepare(
    `SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC`
  ),
  listSessions: db.prepare(`
    SELECT s.id, s.topic, s.initial_problem, s.problem_id, s.started_at, s.ended_at, s.status,
           s.message_count, st.name AS student_name, st.course AS student_course,
           p.title AS problem_title
    FROM sessions s
    JOIN students st ON st.id = s.student_id
    LEFT JOIN problems p ON p.id = s.problem_id
    ORDER BY s.started_at DESC
  `),
  listStudents: db.prepare(`SELECT * FROM students ORDER BY course, name`),
  insertProblem: db.prepare(
    `INSERT INTO problems (title, statement, grade, active) VALUES (@title, @statement, @grade, @active)`
  ),
  updateProblem: db.prepare(`
    UPDATE problems SET title = @title, statement = @statement, grade = @grade, active = @active
    WHERE id = @id
  `),
  setProblemActive: db.prepare(`UPDATE problems SET active = ? WHERE id = ?`),
  deleteProblem: db.prepare(`DELETE FROM problems WHERE id = ?`),
  getProblem: db.prepare(`SELECT * FROM problems WHERE id = ?`),
  listAllProblems: db.prepare(`SELECT * FROM problems ORDER BY created_at DESC`),
  listActiveProblems: db.prepare(`SELECT * FROM problems WHERE active = 1 ORDER BY created_at DESC`),
  problemInUse: db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE problem_id = ?`),
  upsertNotes: db.prepare(`
    INSERT INTO session_notes (session_id, fluidez, flexibilidad, originalidad, comentario, updated_at)
    VALUES (@session_id, @fluidez, @flexibilidad, @originalidad, @comentario, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      fluidez = excluded.fluidez,
      flexibilidad = excluded.flexibilidad,
      originalidad = excluded.originalidad,
      comentario = excluded.comentario,
      updated_at = datetime('now')
  `),
  getNotes: db.prepare(`SELECT * FROM session_notes WHERE session_id = ?`),
  setProblemImages: db.prepare(`UPDATE problems SET images = ? WHERE id = ?`),
  deleteNotesForSession: db.prepare(`DELETE FROM session_notes WHERE session_id = ?`),
  deleteMessagesForSession: db.prepare(`DELETE FROM messages WHERE session_id = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
};

// Los problemas guardan "images" como JSON en la base de datos; estas
// funciones convierten hacia/desde un arreglo de nombres de archivo para
// que el resto del código nunca tenga que pensar en el JSON directamente.
function parseProblemRow(row) {
  if (!row) return row;
  let images = [];
  try {
    images = JSON.parse(row.images || '[]');
    if (!Array.isArray(images)) images = [];
  } catch (_) {
    images = [];
  }
  return { ...row, images };
}

function findOrCreateStudent(name, course) {
  const existing = stmts.findStudent.get(name.trim(), course.trim());
  if (existing) return existing;
  const info = stmts.insertStudent.run(name.trim(), course.trim());
  return { id: info.lastInsertRowid, name: name.trim(), course: course.trim() };
}

function createSession(sessionId, studentId, problemId, topic, initialProblem) {
  stmts.insertSession.run(sessionId, studentId, problemId || null, topic || null, initialProblem || null);
}

// ---- Banco de problemas -------------------------------------------------

function createProblem({ title, statement, grade }) {
  const info = stmts.insertProblem.run({
    title: title.trim(),
    statement: statement.trim(),
    grade: grade ? grade.trim() : null,
    active: 1,
  });
  return parseProblemRow(stmts.getProblem.get(info.lastInsertRowid));
}

function updateProblem(id, { title, statement, grade, active }) {
  const existing = stmts.getProblem.get(id);
  if (!existing) return null;
  stmts.updateProblem.run({
    id,
    title: title != null ? title.trim() : existing.title,
    statement: statement != null ? statement.trim() : existing.statement,
    grade: grade != null ? grade.trim() : existing.grade,
    active: active != null ? (active ? 1 : 0) : existing.active,
  });
  return parseProblemRow(stmts.getProblem.get(id));
}

function setProblemActive(id, active) {
  stmts.setProblemActive.run(active ? 1 : 0, id);
}

function deleteProblem(id) {
  const { n } = stmts.problemInUse.get(id);
  if (n > 0) {
    // No borramos problemas ya usados en conversaciones reales, para no
    // perder el contexto de sesiones guardadas; se desactivan en su lugar.
    setProblemActive(id, false);
    return { deleted: false, deactivated: true };
  }
  stmts.deleteProblem.run(id);
  return { deleted: true, deactivated: false };
}

function getProblem(id) {
  return parseProblemRow(stmts.getProblem.get(id));
}

function listAllProblems() {
  return stmts.listAllProblems.all().map(parseProblemRow);
}

function listActiveProblems() {
  return stmts.listActiveProblems.all().map(parseProblemRow);
}

// Agrega un nombre de archivo de imagen (ya guardado en disco por la ruta
// de subida) a la lista de imágenes de un problema.
function addProblemImage(id, filename) {
  const problem = getProblem(id);
  if (!problem) return null;
  const images = [...problem.images, filename];
  stmts.setProblemImages.run(JSON.stringify(images), id);
  return getProblem(id);
}

// Quita una imagen de la lista del problema (el archivo en disco se borra
// aparte, desde server.js, para mantener esta capa enfocada en la BD).
function removeProblemImage(id, filename) {
  const problem = getProblem(id);
  if (!problem) return null;
  const images = problem.images.filter((f) => f !== filename);
  stmts.setProblemImages.run(JSON.stringify(images), id);
  return getProblem(id);
}

// Elimina por completo una sesión y todo lo que depende de ella (mensajes
// y evaluación cualitativa), para que el docente pueda depurar el panel de
// conversaciones. A diferencia de los problemas, aquí sí se borra de verdad:
// una conversación de prueba o duplicada no tiene el mismo valor de
// conservarse que un problema ya usado por varios estudiantes.
function deleteSession(sessionId) {
  const existing = getSession(sessionId);
  if (!existing) return { deleted: false };
  const tx = db.transaction(() => {
    stmts.deleteNotesForSession.run(sessionId);
    stmts.deleteMessagesForSession.run(sessionId);
    stmts.deleteSession.run(sessionId);
  });
  tx();
  return { deleted: true };
}

function getSession(sessionId) {
  return stmts.getSession.get(sessionId);
}

function addMessage(sessionId, role, content) {
  stmts.insertMessage.run(sessionId, role, content);
  stmts.touchSession.run(sessionId);
}

function getHistory(sessionId) {
  return stmts.getMessages.all(sessionId);
}

function endSession(sessionId) {
  stmts.endSession.run(sessionId);
}

function listSessions() {
  return stmts.listSessions.all();
}

function listStudents() {
  return stmts.listStudents.all();
}

function saveNotes(sessionId, { fluidez, flexibilidad, originalidad, comentario }) {
  stmts.upsertNotes.run({
    session_id: sessionId,
    fluidez: fluidez ?? null,
    flexibilidad: flexibilidad ?? null,
    originalidad: originalidad ?? null,
    comentario: comentario ?? null,
  });
}

function getNotes(sessionId) {
  return stmts.getNotes.get(sessionId);
}

module.exports = {
  db,
  findOrCreateStudent,
  createSession,
  getSession,
  addMessage,
  getHistory,
  endSession,
  deleteSession,
  listSessions,
  listStudents,
  saveNotes,
  getNotes,
  createProblem,
  updateProblem,
  setProblemActive,
  deleteProblem,
  getProblem,
  listAllProblems,
  listActiveProblems,
  addProblemImage,
  removeProblemImage,
};
