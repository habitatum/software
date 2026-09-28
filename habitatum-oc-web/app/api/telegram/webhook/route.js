import { createClient } from '@supabase/supabase-js';
import { telegramFetch, llamarGemini } from '@/lib/telegramComun';
import { procesarMensajeFinanzas, procesarCallbackFinanzas } from '@/lib/telegramFinanzas';

// La lectura de facturas con IA puede tardar varios segundos.
export const maxDuration = 60;

// Usa la service role key: este endpoint lo llama Telegram (no un usuario con
// sesión), así que necesita saltarse RLS para escribir en bitacora_fotos,
// bitacora_dias y telegram_grupos_pendientes.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Telegram siempre debe recibir 200 rápido, incluso si algo interno falla,
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
  // Botones del bot de finanzas (✅ Confirmar / 📂 Capítulo / ❌ Descartar).
  if (update.callback_query) {
    await procesarCallbackFinanzas(supabase, update.callback_query);
    return;
  }

  const mensaje = update.message;
  if (!mensaje) return;
  const chat = mensaje.chat;
  const chatId = String(chat.id);

  // ¿Es el grupo de FINANZAS de un proyecto? (facturas → OC, caja menor)
  const { data: proyectoFinanzas } = await supabase
    .from('proyectos')
    .select('id, nombre, tope_caja_menor')
    .eq('telegram_chat_id_finanzas', chatId)
    .maybeSingle();
  if (proyectoFinanzas) {
    await procesarMensajeFinanzas(supabase, mensaje, proyectoFinanzas);
    return;
  }

  // Grupo de BITÁCORA: solo procesa fotos.
  const esGrupoConocido = await supabase.from('proyectos').select('id').eq('telegram_chat_id', chatId).maybeSingle();
  if (!esGrupoConocido.data) {
    // Grupo todavía no vinculado: se registra (con cualquier mensaje) para que el Admin lo vincule desde /proyectos.
    if (chat.type !== 'private') {
      await supabase.from('telegram_grupos_pendientes').upsert({ chat_id: chatId, titulo: chat.title || chat.first_name || 'Sin nombre' });
    }
    return;
  }
  if (!mensaje.photo || mensaje.photo.length === 0) return;

  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!proyecto) {
    // Grupo todavía no vinculado a ningún proyecto: se registra para que el
    // Admin lo vincule desde /proyectos.
    await supabase.from('telegram_grupos_pendientes').upsert({
      chat_id: chatId,
      titulo: chat.title || chat.first_name || 'Sin nombre',
    });
    return;
  }

  // Telegram entrega varias resoluciones de la misma foto; la última del
  // arreglo es siempre la de mejor calidad.
  const fotoMasGrande = mensaje.photo[mensaje.photo.length - 1];
  const fileInfo = await telegramFetch('getFile', { file_id: fotoMasGrande.file_id });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) return;

  const resFoto = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
  const bufferFoto = Buffer.from(await resFoto.arrayBuffer());

  // Colombia es UTC-5 todo el año (sin horario de verano), así que restar 5
  // horas al instante UTC antes de leer año/mes/día/hora con toISOString()
  // da directamente la fecha y hora "de Colombia", sin depender de que el
  // runtime del servidor tenga configurada esa zona horaria.
  const OFFSET_COLOMBIA_MS = 5 * 60 * 60 * 1000;
  const fechaMensajeUtc = new Date((mensaje.date || Date.now() / 1000) * 1000);
  const fechaMensaje = new Date(fechaMensajeUtc.getTime() - OFFSET_COLOMBIA_MS);
  const fecha = fechaMensaje.toISOString().slice(0, 10); // YYYY-MM-DD (Colombia)
  const hora = fechaMensaje.toISOString().slice(11, 19); // HH:MM:SS (Colombia)

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

// Mismo formato que ya usa el skill bitacora-obra (Telegram + Apps Script +
// Gemini): la IA devuelve JSON {"titulo": "...", "detalle": "..."} — título
// en negrita, detalle en texto normal — para que la bitácora en el software
// y el Excel exportado luzcan igual a la bitácora que ya conocen en obra.
async function describirFotoConIA(bufferFoto, caption) {
  if (!GEMINI_API_KEY) return { titulo: caption || null, detalle: null };
  try {
    const base64 = bufferFoto.toString('base64');
    // Mismo prompt (validado en obra) que usa el skill bitacora-obra en Apps
    // Script, para que la descripción luzca igual en el software y en la
    // bitácora de Google Docs que el equipo ya conoce.
    const prompt =
      'Eres un asistente de bitácora de obra de construcción. Observa la foto del avance de obra y responde ' +
      'ÚNICAMENTE en formato JSON válido, sin texto extra, así: {"titulo":"...","detalle":"..."} . ' +
      "El 'titulo' debe ser una etiqueta corta de 3 a 6 palabras de la actividad principal " +
      "(ej: 'Vaciado de placa en concreto'). " +
      "El 'detalle' debe ser UNA sola frase breve y directa de lo interpretado en la foto, " +
      "SIN usar expresiones como 'se observa', 'se aprecia', 'se ve', 'se evidencia' ni similares " +
      "(ej: 'encofrado de madera con vibrado en proceso'). " +
      'Todo en español, con vocabulario colombiano de construcción (enchape, pañete, mampostería, cielo raso, ' +
      'estuco, entre otros). Nunca uses las palabras operario, operador, trabajador ni obrero. Cuando hagas ' +
      "referencia a personas ejecutando labores, di siempre 'personal de obra'. Sin inventar datos que no se " +
      'vean en la foto.' +
      (caption ? ` Nota adicional de quien envió la foto: "${caption}".` : '');

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
      'Eres quien redacta la bitácora diaria de una obra de construcción en Colombia. A partir de esta lista ' +
      'de actividades registradas hoy en fotos (en el orden en que se tomaron), escribe un párrafo corto, en ' +
      'español, en tercera persona, con vocabulario colombiano de construcción, SIN tecnicismos innecesarios, ' +
      'que resuma el avance del día como si fuera una entrada de bitácora de obra. No repitas la lista tal ' +
      'cual, redáctala como un relato natural y breve (máximo 4-5 líneas).\n\nActividades del día:\n' +
      descripciones.map((d, i) => `${i + 1}. ${d}`).join('\n');

    const texto = await llamarGemini([{ text: prompt }]);
    return texto || descripciones.join('. ') + '.';
  } catch (e) {
    console.error('Error redactando resumen del día:', e);
    return descripciones.join('. ') + '.';
  }
}
