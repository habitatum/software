// Utilidades compartidas por el bot de Telegram (bitácora y finanzas).

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Modelos en orden de preferencia. Si uno no existe o no tiene cupo en la llave,
// se prueba el siguiente (los alias *-latest apuntan siempre al modelo vigente).
export const MODELOS_GEMINI = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'];

// Último error de Gemini (para mostrarlo en el bot y en el diagnóstico).
export let ultimoErrorGemini = null;

export const hayGemini = () => !!GEMINI_API_KEY;

export async function telegramFetch(metodo, params) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function descargarArchivoTelegram(fileId) {
  const info = await telegramFetch('getFile', { file_id: fileId });
  const ruta = info?.result?.file_path;
  if (!ruta) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${ruta}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), ruta };
}

// Prueba cada modelo; dentro de cada uno reintenta una vez ante 429/503.
// Cualquier falla (404, 400, 403, 429 persistente…) pasa al siguiente modelo.
export async function llamarGemini(parts, { json = false, intentosPorModelo = 2 } = {}) {
  if (!GEMINI_API_KEY) { ultimoErrorGemini = 'Falta GEMINI_API_KEY'; return null; }
  const errores = [];
  for (const modelo of MODELOS_GEMINI) {
    for (let intento = 1; intento <= intentosPorModelo; intento++) {
      try {
        const body = { contents: [{ parts }] };
        if (json) body.generationConfig = { responseMimeType: 'application/json', temperature: 0.1 };
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (res.ok) {
          const data = await res.json();
          const texto = data?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
          if (texto) { ultimoErrorGemini = null; return texto; }
          errores.push(`${modelo}: respuesta vacía (${data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'sin detalle'})`);
          break;
        }
        const detalle = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
        if ((res.status === 429 || res.status === 503) && intento < intentosPorModelo && !/limit: 0/.test(detalle)) {
          await new Promise((r) => setTimeout(r, 1500 * intento));
          continue;
        }
        errores.push(`${modelo}: ${res.status} ${detalle}`);
        break;
      } catch (e) {
        if (intento === intentosPorModelo) errores.push(`${modelo}: ${e.message}`);
      }
    }
  }
  ultimoErrorGemini = errores.join(' | ').slice(0, 900);
  console.error('Gemini sin respuesta:', ultimoErrorGemini);
  return null;
}

// Prueba rápida de la llave con cada modelo (para el diagnóstico en /proyectos).
export async function probarModelosGemini() {
  if (!GEMINI_API_KEY) return [{ modelo: '-', estado: 'Falta GEMINI_API_KEY en Vercel' }];
  const out = [];
  for (const modelo of MODELOS_GEMINI) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: OK' }] }] }) }
      );
      const t = (await res.text()).replace(/\s+/g, ' ');
      out.push({ modelo, estado: res.ok ? 'OK ✅' : `${res.status} ${t.slice(0, 140)}` });
    } catch (e) { out.push({ modelo, estado: 'Error: ' + e.message }); }
  }
  return out;
}

export function parsearJSON(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto.replace(/^```(?:json)?\s*|```\s*$/g, '').trim());
  } catch {
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

export function pesos(v) {
  const n = Math.round(Number(v) || 0);
  return '$ ' + n.toLocaleString('es-CO');
}

// Colombia es UTC-5 todo el año.
export function fechaColombia(segundosUnix) {
  const d = new Date((segundosUnix || Date.now() / 1000) * 1000 - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function escaparHTML(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
