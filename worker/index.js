// Backend de Fixture Finder (Freebuff Sites / Cloudflare Workers).
// Sirve el sitio estatico y expone /api/qlab, que convierte un GDTF a .qlablight
// usando la clave de Gemini guardada como secreto del servidor (env.GEMINI_API_KEY).
// La clave nunca llega al navegador.

import '../prompt.js';
import '../jobs.js';

const MODEL = 'gemini-2.5-flash';
const MAX_GDTF = 80000;
const MAX_TPL = 30000;
const LIMIT_HOUR = 12;
const LIMIT_DAY = 40;
const WINDOW_HOUR = 3600000;
const WINDOW_DAY = 86400000;

const SYS = 'Sos un conversor tecnico de definiciones de fixtures de iluminacion escenica. '
  + 'Recibis el description.xml de un GDTF y devolves unicamente el JSON de una definicion '
  + 'de instrumento para QLab 5 (.qlablight). No agregas comentarios, markdown ni explicaciones.';

// prompt.js define globalThis.FF_PROMPT; el navegador carga el mismo archivo como script.
function promptBuilder() {
  return typeof globalThis.FF_PROMPT === 'function' ? globalThis.FF_PROMPT : null;
}

// jobs.js define globalThis.FF_JOBS (ofertas de empleo del sector).
function jobs() {
  return Array.isArray(globalThis.FF_JOBS) ? globalThis.FF_JOBS : [];
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

function j(status, obj, extra) {
  return new Response(JSON.stringify(obj), { status: status, headers: Object.assign({}, HEADERS, extra || {}) });
}

// Limite best-effort por IP dentro del isolate (evita que un solo visitante agote los creditos).
const hits = new Map();

function throttle(ip) {
  const now = Date.now();
  let b = hits.get(ip);
  if (!b) {
    b = { h: 0, h0: now, d: 0, d0: now };
    hits.set(ip, b);
  }
  if (now - b.h0 >= WINDOW_HOUR) { b.h = 0; b.h0 = now; }
  if (now - b.d0 >= WINDOW_DAY) { b.d = 0; b.d0 = now; }
  if (b.h >= LIMIT_HOUR) return Math.ceil((b.h0 + WINDOW_HOUR - now) / 1000);
  if (b.d >= LIMIT_DAY) return Math.ceil((b.d0 + WINDOW_DAY - now) / 1000);
  b.h++;
  b.d++;
  if (hits.size > 4000) {
    hits.forEach(function (v, k) { if (now - v.d0 >= WINDOW_DAY) hits.delete(k); });
  }
  return 0;
}

function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return { ok: true, value: JSON.parse(t.slice(a, b + 1)) }; } catch (e) { /* sigue */ }
  }
  try { return { ok: true, value: JSON.parse(t) }; } catch (e) { /* no es JSON */ }
  return { ok: false, text: t };
}

function health(env) {
  return j(200, { ok: true, serverKey: !!env.GEMINI_API_KEY, model: MODEL, prompt: !!promptBuilder() });
}

async function handleQlab(request, env) {
  if (!env.GEMINI_API_KEY) {
    return j(503, { ok: false, error: 'El servidor no tiene configurada la clave GEMINI_API_KEY.' });
  }
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return j(403, { ok: false, error: 'Origen no permitido' });
  }
  const ct = request.headers.get('content-type') || '';
  if (ct.indexOf('application/json') === -1) {
    return j(415, { ok: false, error: 'Content-Type debe ser application/json' });
  }

  let body;
  try { body = await request.json(); } catch (e) { return j(400, { ok: false, error: 'JSON invalido' }); }
  if (!body || typeof body !== 'object') return j(400, { ok: false, error: 'Cuerpo invalido' });

  const gdtf = typeof body.gdtf === 'string' ? body.gdtf.trim() : '';
  const tpl = typeof body.template === 'string' ? body.template.slice(0, MAX_TPL) : '';
  const name = typeof body.name === 'string' ? body.name.slice(0, 120) : '';
  if (!gdtf) return j(400, { ok: false, error: 'Falta la definicion GDTF' });
  if (gdtf.length > MAX_GDTF) {
    return j(413, { ok: false, error: 'El GDTF supera el maximo de ' + MAX_GDTF + ' caracteres' });
  }

  const build = promptBuilder();
  if (!build) return j(500, { ok: false, error: 'Falta el modulo de prompt en el servidor' });

  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const wait = throttle(ip);
  if (wait) {
    return j(429, { ok: false, error: 'Demasiadas conversiones seguidas. Proba en ' + Math.ceil(wait / 60) + ' min.' }, { 'retry-after': String(wait) });
  }

  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS }] },
        contents: [{ role: 'user', parts: [{ text: build(gdtf, tpl, name) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 8192 }
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return j(504, { ok: false, error: timedOut ? 'Gemini tardo demasiado en responder' : 'No se pudo contactar a Gemini' });
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta no JSON */ }

  if (!res.ok) {
    const msg = data && data.error && data.error.message ? String(data.error.message) : ('HTTP ' + res.status);
    const status = res.status === 429 ? 429 : 502;
    return j(status, { ok: false, error: 'Gemini: ' + msg.slice(0, 300) });
  }

  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('');
  if (!text) return j(502, { ok: false, error: 'Gemini devolvio una respuesta vacia' });

  const parsed = extractJson(text);
  if (parsed.ok) {
    return j(200, { ok: true, qlab: parsed.value, model: MODEL, usage: (data && data.usageMetadata) || null });
  }
  return j(200, { ok: true, text: parsed.text, warning: 'La respuesta no es JSON valido', model: MODEL });
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function parseJobDate(s) {
  var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d.toUTCString();
}

function handleJobs(request) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET' && request.method !== 'HEAD') return j(405, { ok: false, error: 'Metodo no permitido' });
  const list = jobs();
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }, cors) });
  return new Response(JSON.stringify({ ok: true, count: list.length, items: list }), {
    status: 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }, cors)
  });
}

function handleFeed(request) {
  const base = new URL(request.url).origin;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET' && request.method !== 'HEAD') return j(405, { ok: false, error: 'Metodo no permitido' });
  const list = jobs();
  const now = new Date().toUTCString();
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
  xml += '<channel>\n';
  xml += '<title>Empleo espectaculos y eventos - Fixture Finder</title>\n';
  xml += '<link>' + escXml(base + '/') + '</link>\n';
  xml += '<description>Ofertas de empleo del sector espectaculos, eventos, iluminacion y audiovisual en Espana.</description>\n';
  xml += '<language>es</language>\n';
  xml += '<lastBuildDate>' + now + '</lastBuildDate>\n';
  xml += '<atom:link href="' + escXml(base + '/api/feed') + '" rel="self" type="application/rss+xml"/>\n';
  list.forEach(function (j) {
    xml += '<item>\n';
    xml += '<title>' + escXml(j.title + ' - ' + j.company) + '</title>\n';
    xml += '<link>' + escXml(j.url) + '</link>\n';
    xml += '<guid isPermaLink="true">' + escXml(j.url) + '</guid>\n';
    var pd = parseJobDate(j.published);
    if (pd) xml += '<pubDate>' + pd + '</pubDate>\n';
    xml += '<category>' + escXml(j.cat) + '</category>\n';
    xml += '<description>' + escXml((j.summary || '') + ' | Ubicacion: ' + (j.location || '') + ' | Contrato: ' + (j.contract || '') + ' | Salario: ' + (j.salary || '') + ' | Encaje: ' + (j.encaje || '') + ' | Tecnologias: ' + (j.tech || '')) + '</description>\n';
    xml += '</item>\n';
  });
  xml += '</channel>\n</rss>\n';
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: Object.assign({ 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' }, cors) });
  return new Response(xml, { status: 200, headers: Object.assign({ 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }, cors) });
}

export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); } catch (e) { return j(400, { ok: false, error: 'URL invalida' }); }

    try {
      if (url.pathname === '/api/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return j(405, { ok: false, error: 'Metodo no permitido' });
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers: HEADERS });
        return health(env);
      }
      if (url.pathname === '/api/qlab') {
        if (request.method !== 'POST') return j(405, { ok: false, error: 'Metodo no permitido' });
        return await handleQlab(request, env);
      }
      if (url.pathname === '/api/jobs' || url.pathname === '/jobs.json') {
        return handleJobs(request);
      }
      if (url.pathname === '/api/feed' || url.pathname === '/feed.xml' || url.pathname === '/rss.xml') {
        return handleFeed(request);
      }
      if (url.pathname.indexOf('/api/') === 0) return j(404, { ok: false, error: 'No existe' });

      if (!env.ASSETS) return j(500, { ok: false, error: 'Sin assets configurados' });
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return j(500, { ok: false, error: 'Error interno del servidor' });
    }
  }
};
