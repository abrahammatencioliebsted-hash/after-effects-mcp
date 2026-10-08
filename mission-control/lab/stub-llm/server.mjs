// MODELO SIMULADO (stub) compatible con la API de OpenAI. Solo para pruebas de integración.
// No llama a ningún proveedor real. Respuestas deterministas con la marca MC-STUB-OK.
import http from 'node:http';

const PORT = Number(process.env.STUB_LLM_PORT || 8700);
const MODEL = process.env.STUB_LLM_MODEL || 'stub-model';
const log = (...a) => console.log(new Date().toISOString(), ...a);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join(' ');
  return '';
}
function replyFor(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = textOf(lastUser?.content ?? '');
  const n = text.length;
  return `Respuesta del MODELO SIMULADO (stub). Petición recibida con ${n} caracteres. ` +
    `No se ejecutó ninguna acción externa. Resultado: tarea completada. Marca: MC-STUB-OK`;
}
function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = '';
  for await (const c of req) body += c;
  log(req.method, url.pathname, `${body.length}B`);
  if (req.method === 'GET' && /\/v1\/models$/.test(url.pathname)) {
    return json(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'stub' }] });
  }
  if (req.method === 'POST' && /\/v1\/chat\/completions$/.test(url.pathname)) {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: { message: 'JSON inválido' } }); }
    const content = replyFor(payload.messages || []);
    const id = `chatcmpl-stub-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = payload.model || MODEL;
    const usage = { prompt_tokens: Math.ceil(body.length / 4), completion_tokens: Math.ceil(content.length / 4) };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    if (payload.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const chunk = (delta, finish = null, extra = {}) =>
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
      chunk({ role: 'assistant', content: '' });
      for (const part of content.match(/.{1,24}/g) || []) chunk({ content: part });
      chunk({}, 'stop');
      if (payload.stream_options?.include_usage) {
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    return json(res, 200, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage });
  }
  if (req.method === 'POST' && /\/v1\/responses$/.test(url.pathname)) {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: { message: 'JSON inválido' } }); }
    const input = typeof payload.input === 'string' ? [{ role: 'user', content: payload.input }] : (payload.input || []);
    const text = replyFor(input);
    const id = `resp_stub_${Date.now()}`;
    const usage = { input_tokens: Math.ceil(body.length / 4), output_tokens: Math.ceil(text.length / 4) };
    usage.total_tokens = usage.input_tokens + usage.output_tokens;
    const response = { id, object: 'response', status: 'completed', model: payload.model || MODEL,
      output: [{ id: `msg_${id}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage };
    if (payload.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('response.created', { response: { ...response, status: 'in_progress', output: [] } });
      ev('response.output_text.delta', { item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: text });
      ev('response.completed', { response });
      res.end();
      return;
    }
    return json(res, 200, response);
  }
  if (req.method === 'GET' && /\/health$/.test(url.pathname)) return json(res, 200, { ok: true, simulated: true, model: MODEL });
  json(res, 404, { error: { message: `ruta no soportada por el stub: ${req.method} ${url.pathname}` } });
});
server.listen(PORT, '127.0.0.1', () => log(`stub-llm (MODELO SIMULADO) escuchando en http://127.0.0.1:${PORT}/v1`));
