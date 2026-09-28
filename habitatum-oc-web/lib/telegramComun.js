// Utilidades compartidas por el bot de Telegram (bitácora y finanzas).

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Mismo orden de respaldo del skill bitacora-obra: si un modelo no está
// disponible (404) se prueba el siguiente.
export const MODELOS_GEMINI = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

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

// Recorre MODELOS_GEMINI; dentro de cada modelo reintenta ante 429/503 con backoff.
export async function llamarGemini(parts, { json = false, intentosPorModelo = 2 } = {}) {
  if (!GEMINI_API_KEY) return null;
  for (const modelo of MODELOS_GEMINI) {
    let ultimoStatus = null;
    for (let intento = 1; intento <= intentosPorModelo; intento++) {
      try {
        const body = { contents: [{ parts }] };
        if (json) body.generationConfig = { responseMimeType: 'application/json', temperature: 0.1 };
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        ultimoStatus = res.status;
        if ((res.status === 429 || res.status === 503) && intento < intentosPorModelo) {
          await new Promise((r) => setTimeout(r, 1000 * intento));
          continue;
        }
        if (res.status === 404 || res.status === 400) break; // modelo no disponible: probar el siguiente
        if (!res.ok) break;
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || null;
      } catch {
        if (intento === intentosPorModelo) break;
      }
    }
    if (ultimoStatus !== 404 && ultimoStatus !== 400 && ultimoStatus !== null) return null;
  }
  return null;
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
