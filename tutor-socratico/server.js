// server.js
// Servidor principal del Tutor Socrático de Matemáticas.
// Sirve la interfaz del estudiante y del docente, expone la API de chat
// (respaldada por Claude) y persiste cada conversación en SQLite para
// su análisis posterior.

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');

const db = require('./src/db');
const { buildSystemPrompt } = require('./src/socraticPrompt');
const { getTutorReply } = require('./src/claude');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

// Las imágenes que el docente adjunta a un problema (por ejemplo, una
// gráfica hecha en PSTricks y exportada como PNG) se guardan en la misma
// carpeta de datos persistente que la base de datos (DATA_DIR), para que
// sobrevivan a un redespliegue igual que las conversaciones guardadas.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.has(file.mimetype));
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ---------------------------------------------------------------------
// Middleware de autenticación simple para el panel docente.
// No es un sistema de autenticación robusto: pensado para un solo
// docente o un pequeño equipo, protegido por una contraseña compartida
// definida en la variable de entorno ADMIN_PASSWORD.
// ---------------------------------------------------------------------
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({
      error: 'El servidor no tiene configurada ADMIN_PASSWORD. Ver .env.example.',
    });
  }
  const provided = req.header('x-admin-password');
  if (provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña de docente incorrecta.' });
  }
  next();
}

// =======================================================================
// API — Estudiante
// =======================================================================

// Lista los problemas activos que el docente publicó, para que el
// estudiante elija uno. El estudiante NO puede escribir su propio tema:
// solo puede trabajar sobre problemas que el docente haya ingresado.
app.get('/api/problems', (req, res) => {
  const problems = db.listActiveProblems().map((p) => ({
    id: p.id,
    title: p.title,
    statement: p.statement,
    grade: p.grade,
    images: p.images,
  }));
  res.json(problems);
});

// Inicia una nueva sesión de tutoría para un estudiante, sobre un
// problema específico previamente publicado por el docente.
app.post('/api/session', async (req, res) => {
  try {
    const { name, course, problemId } = req.body || {};
    if (!name || !course) {
      return res.status(400).json({ error: 'Se requiere nombre y curso.' });
    }
    if (!problemId) {
      return res.status(400).json({ error: 'Debes elegir un problema para empezar.' });
    }

    const problem = db.getProblem(problemId);
    if (!problem || !problem.active) {
      return res.status(400).json({ error: 'Ese problema ya no está disponible. Elige otro.' });
    }

    const student = db.findOrCreateStudent(name, course);

    const systemPrompt = buildSystemPrompt({
      studentName: student.name,
      course: student.course,
      problemStatement: problem.statement,
      problemTitle: problem.title,
    });

    // Primer turno: el tutor abre la conversación con una pregunta sobre
    // el problema publicado por el docente.
    const opener = `Este es el problema que voy a trabajar: "${problem.title}". ${problem.statement}`;

    // Solo creamos la sesión en la base de datos si Claude responde con
    // éxito, para no dejar sesiones "fantasma" vacías cuando falla la API.
    const history = [{ role: 'student', content: opener }];
    const tutorReply = await getTutorReply(systemPrompt, history);

    const sessionId = randomUUID();
    db.createSession(sessionId, student.id, problem.id, problem.title, problem.statement);
    db.addMessage(sessionId, 'student', opener);
    db.addMessage(sessionId, 'tutor', tutorReply);

    res.json({ sessionId, tutorReply, problem });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error iniciando la sesión.' });
  }
});

// Envía un mensaje del estudiante y obtiene la respuesta del tutor.
app.post('/api/session/:id/message', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body || {};
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Mensaje vacío.' });
    }

    const session = db.getSession(id);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
    if (session.status === 'completed') {
      return res.status(400).json({ error: 'Esta sesión ya fue finalizada.' });
    }

    const student = db.listStudents().find((s) => s.id === session.student_id);
    const problem = session.problem_id ? db.getProblem(session.problem_id) : null;
    const systemPrompt = buildSystemPrompt({
      studentName: student?.name,
      course: student?.course,
      problemStatement: problem?.statement || session.initial_problem,
      problemTitle: problem?.title || session.topic,
    });

    db.addMessage(id, 'student', content.trim());
    const history = db.getHistory(id);
    const tutorReply = await getTutorReply(systemPrompt, history);
    db.addMessage(id, 'tutor', tutorReply);

    res.json({ tutorReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error generando la respuesta.' });
  }
});

// Finaliza una sesión (el estudiante decide terminar).
app.post('/api/session/:id/end', (req, res) => {
  const { id } = req.params;
  const session = db.getSession(id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
  db.endSession(id);
  res.json({ ok: true });
});

// =======================================================================
// API — Docente / análisis
// =======================================================================

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada en el servidor.' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  res.json({ ok: true });
});

app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  res.json(db.listSessions());
});

app.get('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
  const student = db.listStudents().find((s) => s.id === session.student_id);
  const messages = db.getHistory(req.params.id);
  const notes = db.getNotes(req.params.id);
  res.json({ session, student, messages, notes });
});

app.post('/api/admin/sessions/:id/notes', requireAdmin, (req, res) => {
  const { fluidez, flexibilidad, originalidad, comentario } = req.body || {};
  db.saveNotes(req.params.id, { fluidez, flexibilidad, originalidad, comentario });
  res.json({ ok: true });
});

// Elimina por completo una conversación (mensajes + evaluación incluidos).
// Pensado para que el docente pueda depurar el panel: borrar pruebas,
// duplicados o conversaciones que ya no necesita conservar.
app.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
  db.deleteSession(req.params.id);
  res.json({ ok: true });
});

// ---- Banco de problemas (gestión docente) ----------------------------

app.get('/api/admin/problems', requireAdmin, (req, res) => {
  res.json(db.listAllProblems());
});

app.post('/api/admin/problems', requireAdmin, (req, res) => {
  const { title, statement, grade } = req.body || {};
  if (!title || !title.trim() || !statement || !statement.trim()) {
    return res.status(400).json({ error: 'El problema necesita título y enunciado.' });
  }
  const problem = db.createProblem({ title, statement, grade });
  res.json(problem);
});

app.put('/api/admin/problems/:id', requireAdmin, (req, res) => {
  const { title, statement, grade, active } = req.body || {};
  const updated = db.updateProblem(req.params.id, { title, statement, grade, active });
  if (!updated) return res.status(404).json({ error: 'Problema no encontrado.' });
  res.json(updated);
});

app.post('/api/admin/problems/:id/toggle', requireAdmin, (req, res) => {
  const problem = db.getProblem(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Problema no encontrado.' });
  db.setProblemActive(problem.id, !problem.active);
  res.json(db.getProblem(problem.id));
});

app.delete('/api/admin/problems/:id', requireAdmin, (req, res) => {
  const problem = db.getProblem(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Problema no encontrado.' });
  const result = db.deleteProblem(req.params.id);
  res.json(result);
});

// Sube una o varias imágenes (por ejemplo, una gráfica hecha en PSTricks y
// exportada como PNG) y las adjunta al enunciado de un problema. El
// enunciado en sí sigue siendo texto (con LaTeX entre $...$ para fórmulas);
// las imágenes se muestran aparte, debajo del enunciado.
app.post('/api/admin/problems/:id/images', requireAdmin, (req, res) => {
  const problem = db.getProblem(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Problema no encontrado.' });

  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'No se pudieron subir las imágenes.' });
    }
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen válida (PNG, JPG, GIF, WEBP o SVG).' });
    }
    let updated = problem;
    for (const file of files) {
      updated = db.addProblemImage(req.params.id, file.filename);
    }
    res.json(updated);
  });
});

// Quita una imagen de un problema y borra el archivo del disco.
app.delete('/api/admin/problems/:id/images/:filename', requireAdmin, (req, res) => {
  const problem = db.getProblem(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Problema no encontrado.' });
  const { filename } = req.params;
  const updated = db.removeProblemImage(req.params.id, filename);
  const filePath = path.join(UPLOADS_DIR, filename);
  // path.join normaliza "..": si alguien manda un filename raro no se sale de UPLOADS_DIR.
  if (filePath.startsWith(UPLOADS_DIR) && fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }
  res.json(updated);
});

// Exporta todas las conversaciones en CSV (una fila por mensaje) para
// análisis en Excel/Sheets/software estadístico.
app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const sessions = db.listSessions();
  const rows = [
    ['sesion_id', 'estudiante', 'curso', 'tema', 'inicio', 'fin', 'estado', 'turno', 'rol', 'mensaje', 'fecha_hora'],
  ];
  for (const s of sessions) {
    const msgs = db.getHistory(s.id);
    msgs.forEach((m, i) => {
      rows.push([
        s.id,
        s.student_name,
        s.student_course,
        s.topic || '',
        s.started_at,
        s.ended_at || '',
        s.status,
        i + 1,
        m.role,
        (m.content || '').replace(/"/g, '""').replace(/\r?\n/g, ' '),
        m.created_at,
      ]);
    });
  }
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="conversaciones_tutor_socratico.csv"');
  res.send('﻿' + csv); // BOM para que Excel detecte UTF-8 correctamente
});

app.get('/api/admin/export.json', requireAdmin, (req, res) => {
  const sessions = db.listSessions().map((s) => ({
    ...s,
    messages: db.getHistory(s.id),
    notes: db.getNotes(s.id) || null,
  }));
  res.json(sessions);
});

// =======================================================================

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Tutor Socrático escuchando en http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY no está definida — el chat no funcionará hasta configurarla en .env');
  }
  if (!ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_PASSWORD no está definida — el panel docente no funcionará hasta configurarla en .env');
  }
});
