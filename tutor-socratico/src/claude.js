// src/claude.js
// Cliente delgado sobre la API de Claude (Anthropic) para generar las
// respuestas del tutor socrático.

const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Falta ANTHROPIC_API_KEY. Defínela en el archivo .env (ver .env.example).'
    );
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_TOKENS = 500; // respuestas cortas: el tutor pregunta, no da discursos

/**
 * Genera la siguiente respuesta del tutor.
 * @param {string} systemPrompt - prompt de sistema (pedagogía + contexto de la sesión)
 * @param {{role: 'student'|'tutor', content: string}[]} history - turnos previos
 * @returns {Promise<string>} texto de la respuesta del tutor
 */
async function getTutorReply(systemPrompt, history) {
  const anthropic = getClient();

  const messages = history.map((m) => ({
    role: m.role === 'tutor' ? 'assistant' : 'user',
    content: m.content,
  }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { getTutorReply };
