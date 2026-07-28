import { createClient } from '@supabase/supabase-js';

// Usa la service role key: este endpoint lo llama Telegram (no un usuario con
// sesión), así que necesita saltarse RLS para escribir en bitacora_fotos,
// bitacora_dias y telegram_grupos_pendientes.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODELO_GEMINI = 'gemini-2.0-flash';

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

  const fechaMensaje = new Date((mensaje.date || Date.now() / 1000) * 1000);
  const fecha = fechaMensaje.toISOString().slice(0, 10); // YYYY-MM-DD
  const hora = fechaMensaje.toISOString().slice(11, 19); // HH:MM:SS

  const rutaArchivo = `${proyecto.id}/${fecha}/${mensaje.message_id}.jpg`;
  await supabase.storage.from('bitacora-fotos').upload(rutaArchivo, bufferFoto, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  const { data: urlPublica } = supabase.storage.from('bitacora-fotos').getPublicUrl(rutaArchivo);

  const descripcion = await describirFotoConIA(bufferFoto, mensaje.caption);

  await supabase.from('bitacora_fotos').insert({
    proyecto_id: proyecto.id,
    fecha,
    hora,
    foto_url: urlPublica.publicUrl,
    descripcion_ia: descripcion,
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

async function llamarGemini(parts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function describirFotoConIA(bufferFoto, caption) {
  if (!GEMINI_API_KEY) return caption || null;
  try {
    const base64 = bufferFoto.toString('base64');
    const prompt =
      'Eres un asistente que revisa fotos de avance de una obra de construcción o reforma en Colombia. ' +
      'Describe en UNA sola frase corta, en español, sin tecnicismos innecesarios, qué actividad de ' +
      'construcción muestra la foto (ejemplo: "Vaciado de placa en concreto", "Instalación de tubería ' +
      'eléctrica", "Pañete de muros en segundo piso"). Si la foto no muestra una actividad de construcción ' +
      'clara, describe brevemente lo que se ve. No agregues comillas ni prefijos, solo la frase.' +
      (caption ? ` Nota adicional de quien envió la foto: "${caption}".` : '');

    const texto = await llamarGemini([
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: base64 } },
    ]);
    return texto || caption || null;
  } catch (e) {
    console.error('Error describiendo foto con IA:', e);
    return caption || null;
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
