import { createClient } from '@supabase/supabase-js';

// Usa la service role key: este endpoint lo llama Telegram (no un usuario con
// sesion), asi que necesita saltarse RLS para escribir en bitacora_fotos,
// bitacora_dias y telegram_grupos_pendientes.
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Mismos modelos (y mismo orden de respaldo) que el skill bitacora-obra ya
// probado en Apps Script: si el primero no esta disponible en el proyecto de
// Gemini, se reintenta con el siguiente antes de fallar.
const MODELOS_GEMINI = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

// Telegram siempre debe recibir 200 rapido, incluso si algo interno falla,
// para que no reintente el mismo mensaje una y otra vez.
export async function POST(request) {
    const secretEsperado = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secretEsperado) {
          const secretRecibido = request.headers.get('x-telegram-bot-api-secret-token');
          if (secretRecibido !== secretEsperado) {
                  return new Response('No autorizado', { status: 401 });
          }
    }

  let update;
    try {
          update = await request.json();
    } catch {
          return new Response('OK', { status: 200 });
    }

  try {
        await procesarUpdate(update);
  } catch (e) {
        console.error('Error procesando update de Telegram:', e);
  }

  return new Response('OK', { status: 200 });
}

async function procesarUpdate(update) {
    const mensaje = update.message;
    if (!mensaje || !mensaje.photo || mensaje.photo.length === 0) return;

  const chat = mensaje.chat;
    const chatId = String(chat.id);

  const { data: proyecto } = await supabase
      .from('proyectos')
      .select('id')
      .eq('telegram_chat_id', chatId)
      .maybeSingle();

  if (!proyecto) {
        // Grupo todavia no vinculado a ningun proyecto: se registra para que el
      // Admin lo vincule desde /proyectos.
      await supabase.from('telegram_grupos_pendientes').upsert({
              chat_id: chatId,
              titulo: chat.title || chat.first_name || 'Sin nombre',
      });
        return;
  }

  // Telegram entrega varias resoluciones de la misma foto; la ultima del
  // arreglo es siempre la de mejor calidad.
  const fotoMasGrande = mensaje.photo[mensaje.photo.length - 1];
    const fileInfo = await telegramFetch('getFile', { file_id: fotoMasGrande.file_id });
    const filePath = fileInfo?.result?.file_path;
    if (!filePath) return;

  const resFoto = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
    const bufferFoto = Buffer.from(await resFoto.arrayBuffer());

  const fechaMensaje = new Date((mensaje.date || Date.now() / 1000) * 1000);
    const fecha = fechaMensaje.toISOString().slice(0, 10); // YYYY-MM-DD
  const hora = fechaMensaje.toISOString().slice(11, 19); // HH:MM:SS

  const rutaArchivo = `${proyecto.id}/${fecha}/${mensaje.message_id}.jpg`;
    await supabase.storage.from('bitacora-fotos').upload(rutaArchivo, bufferFoto, {
          contentType: 'image/jpeg',
          upsert: true,
    });
    const { data: urlPublica } = supabase.storage.from('bitacora-fotos').getPublicUrl(rutaArchivo);

  const { titulo, detalle } = await describirFotoConIA(bufferFoto, mensaje.caption);

  await supabase.from('bitacora_fotos').insert({
        proyecto_id: proyecto.id,
        fecha,
        hora,
        foto_url: urlPublica.publicUrl,
        titulo_ia: titulo,
        descripcion_ia: detalle,
        remitente: mensaje.from?.first_name || mensaje.from?.username || null,
        telegram_message_id: mensaje.message_id,
  });

  await actualizarResumenDelDia(proyecto.id, fecha);
}

async function telegramFetch(metodo, params) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${metodo}`;
    const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
    });
    return res.json();
}

// Igual que el skill bitacora-obra en Apps Script: recorre MODELOS_GEMINI en
// orden (si un modelo no esta disponible en el proyecto, prueba el
// siguiente) y dentro de cada modelo reintenta ante 429 (cupo agotado) / 503
// (sobrecarga) con backoff.
async function llamarGemini(parts, intentosPorModelo = 2) {
    for (const modelo of MODELOS_GEMINI) {
          let ultimoStatus = null;
          for (let intento = 1; intento <= intentosPorModelo; intento++) {
                  try {
                            const res = await fetch(
                                        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`,
                              {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ contents: [{ parts }] }),
                              }
                                      );
                            ultimoStatus = res.status;
                            if ((res.status === 429 || res.status === 503) && intento < intentosPorModelo) {
                                        await new Promise((r) => setTimeout(r, 800 * intento));
                                        continue;
                            }
                            if (res.status === 404) break; // modelo no disponible: probar el siguiente
                    if (!res.ok) break;
                            const data = await res.json();
                            return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
                  } catch (e) {
                            if (intento === intentosPorModelo) break;
                  }
          }
          if (ultimoStatus !== 404 && ultimoStatus !== null) {
                  // Fallo por algo distinto a "modelo no disponible" (ej. 429 persistente):
            // no vale la pena seguir probando otros modelos, se pierde igual.
            return null;
          }
    }
    return null;
}

// Mismo formato que ya usa el skill bitacora-obra (Telegram + Apps Script +
// Gemini): la IA devuelve JSON {"titulo": "...", "detalle": "..."} -- titulo
// en negrita, detalle en texto normal -- para que la bitacora en el software
// y el Excel exportado luzcan igual a la bitacora que ya conocen en obra.
async function describirFotoConIA(bufferFoto, caption) {
    if (!GEMINI_API_KEY) return { titulo: caption || null, detalle: null };
    try {
          const base64 = bufferFoto.toString('base64');
          // Mismo prompt (validado en obra) que usa el skill bitacora-obra en Apps
      // Script, para que la descripcion luzca igual en el software y en la
      // bitacora de Google Docs que el equipo ya conoce.
      const prompt =
              'Eres un asistente de bitacora de obra de construccion. Observa la foto del avance de obra y responde ' +
              'UNICAMENTE en formato JSON valido, sin texto extra, asi: {"titulo":"...","detalle":"..."} . ' +
              "El 'titulo' debe ser una etiqueta corta de 3 a 6 palabras de la actividad principal " +
              "(ej: 'Vaciado de placa en concreto'). " +
              "El 'detalle' debe ser UNA sola frase breve y directa de lo interpretado en la foto, " +
              "SIN usar expresiones como 'se observa', 'se aprecia', 'se ve', 'se evidencia' ni similares " +
              "(ej: 'encofrado de madera con vibrado en proceso'). " +
              'Todo en espanol, con vocabulario colombiano de construccion (enchape, panete, mamposteria, cielo raso, ' +
              'estuco, entre otros). Nunca uses las palabras operario, operador, trabajador ni obrero. Cuando hagas ' +
              "referencia a personas ejecutando labores, di siempre 'personal de obra'. Sin inventar datos que no se " +
              'vean en la foto.' +
              (caption ? ` Nota adicional de quien envio la foto: "${caption}".` : '');

      const texto = await llamarGemini([
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            ]);
          if (!texto) return { titulo: caption || null, detalle: null };

      const json = JSON.parse(texto.replace(/^```json\s*|```$/g, '').trim());
          return { titulo: json.titulo || caption || null, detalle: json.detalle || null };
    } catch (e) {
          console.error('Error describiendo foto con IA:', e);
          return { titulo: caption || null, detalle: null };
    }
}

async function actualizarResumenDelDia(proyectoId, fecha) {
    const { data: fotosDelDia } = await supabase
      .from('bitacora_fotos')
      .select('descripcion_ia, hora')
      .eq('proyecto_id', proyectoId)
      .eq('fecha', fecha)
      .order('hora');

  const descripciones = (fotosDelDia || []).map((f) => f.descripcion_ia).filter(Boolean);
    const cantidad = fotosDelDia?.length || 0;

  let resumen = null;
    if (descripciones.length > 0) {
          resumen = GEMINI_API_KEY ? await redactarResumenConIA(descripciones) : descripciones.join('. ') + '.';
    }

  await supabase.from('bitacora_dias').upsert(
    {
            proyecto_id: proyectoId,
            fecha,
            resumen_texto: resumen,
            cantidad_fotos: cantidad,
            actualizado_en: new Date().toISOString(),
    },
    { onConflict: 'proyecto_id,fecha' }
      );
}

async function redactarResumenConIA(descripciones) {
    try {
          const prompt =
                  'Eres quien redacta la bitacora diaria de una obra de construccion en Colombia. A partir de esta lista ' +
                  'de actividades registradas hoy en fotos (en el orden en que se tomaron), escribe un parrafo corto, en ' +
                  'espanol, en tercera persona, con vocabulario colombiano de construccion, SIN tecnicismos innecesarios, ' +
                  'que resuma el avance del dia como si fuera una entrada de bitacora de obra. No repitas la lista tal ' +
                  'cual, redactala como un relato natural y breve (maximo 4-5 lineas).\n\nActividades del dia:\n' +
                  descripciones.map((d, i) => `${i + 1}. ${d}`).join('\n');

      const texto = await llamarGemini([{ text: prompt }]);
          return texto || descripciones.join('. ') + '.';
    } catch (e) {
          console.error('Error redactando resumen del dia:', e);
          return descripciones.join('. ') + '.';
    }
}
