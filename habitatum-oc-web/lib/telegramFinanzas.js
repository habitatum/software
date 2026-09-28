// ============================================================
// Bot de FINANZAS (Residente C automático) para proyectos todo costo.
//
// Flujo en el grupo de finanzas del proyecto:
//  1. Llega foto/PDF de factura, recibo o comprobante (con nota opcional).
//     - Nota con "CAJA MENOR" → gasto de caja menor (se acumula hasta el tope).
//     - Nota con "cap 7" / "capítulo 9.03" → fija el capítulo del presupuesto.
//  2. Gemini lee el documento y propone la OC (o el gasto). Se guarda como
//     borrador y el bot responde con el resumen y botones:
//        ✅ Confirmar · 📂 Capítulo · ❌ Descartar
//  3. Al confirmar, la base de datos crea la OC firmada por "Residente C"
//     (bot_crear_oc) o registra el gasto (bot_registrar_caja_menor), que al
//     alcanzar el tope genera la OC de legalización automáticamente.
// Comandos: /estado (caja menor acumulada) · /cerrarcaja (legalizar ya) · /ayuda
// ============================================================
import {
  telegramFetch, descargarArchivoTelegram, llamarGemini, parsearJSON, pesos, fechaColombia, escaparHTML, hayGemini,
} from './telegramComun';

const RE_CAJA_MENOR = /caja\s*menor/i;
const RE_CAPITULO = /\bcap(?:[íi]tulo)?\.?\s*(\d{1,2}(?:\.\d{1,2})?)/i;

const AYUDA =
  '<b>Residente C · Finanzas</b>\n' +
  '• Envía la <b>foto o PDF de la factura</b> y creo la Orden de Compra.\n' +
  '• Si es un gasto pequeño o sin factura, escribe <b>CAJA MENOR</b> en la nota de la foto (o un mensaje como <i>CAJA MENOR 25000 transporte cap 7</i>).\n' +
  '• Para indicar el capítulo escribe <b>cap 7</b> en la nota. Si no, lo sugiero yo.\n' +
  '• /estado → caja menor acumulada · /cerrarcaja → legalizar la caja menor ya.';

async function capitulosDelProyecto(supabase, proyectoId) {
  const { data: pres } = await supabase.from('presupuestos').select('id').eq('proyecto_id', proyectoId).maybeSingle();
  if (!pres) return [];
  const { data } = await supabase.from('presupuesto_capitulos').select('id, codigo, nombre, tipo_capitulo').eq('presupuesto_id', pres.id).order('orden');
  return data || [];
}

function capituloPorCodigo(capitulos, codigo) {
  if (!codigo) return null;
  const c = String(codigo).trim().split('.')[0].replace(/^0+(?=\d)/, '');
  return capitulos.find((x) => String(x.codigo).replace(/^0+(?=\d)/, '') === c) || null;
}

// ---------- Lectura con IA ----------
function promptFactura(capitulos, nota) {
  return (
    'Eres el residente de obra de una constructora colombiana y debes convertir una factura, recibo o comprobante ' +
    'de pago en una Orden de Compra. Lee el documento y responde SOLO un JSON con esta forma exacta:\n' +
    '{"es_documento_de_pago":true,"tipo_orden":"COMPRA|SERVICIO","proveedor_nombre":"","proveedor_nit":"",' +
    '"numero_factura":"","fecha":"YYYY-MM-DD","items":[{"descripcion":"","unidad":"","cantidad":1,"valor_unitario":0}],' +
    '"precios_incluyen_iva":false,"descuento":0,"iva_porcentaje":0,"total":0,"capitulo_codigo":"","concepto":""}\n' +
    'Reglas: valores numéricos sin puntos ni signos. "valor_unitario" tal como aparece en la factura. Si la factura ' +
    'discrimina IVA, pon iva_porcentaje (normalmente 19) y precios_incluyen_iva=false; si es un tiquete/recibo donde ' +
    'el precio ya trae el IVA incluido o no hay IVA, pon precios_incluyen_iva=true e iva_porcentaje=0. "total" es el ' +
    'valor final pagado. "tipo_orden": SERVICIO si es mano de obra, transporte, alquiler o servicio; si no, COMPRA. ' +
    '"concepto": resumen de 3 a 8 palabras. "capitulo_codigo": el código del capítulo del presupuesto que mejor ' +
    'corresponde, elegido de esta lista:\n' +
    capitulos.map((c) => `${c.codigo} = ${c.nombre}`).join('\n') +
    '\nSi el documento no es una factura/recibo/comprobante de pago, pon es_documento_de_pago=false.' +
    (nota ? `\nNota de quien lo envió: "${nota}"` : '')
  );
}

function promptCajaMenor(capitulos, texto) {
  return (
    'Registra un gasto de CAJA MENOR de una obra en Colombia. Responde SOLO un JSON: ' +
    '{"valor":0,"concepto":"","fecha":"YYYY-MM-DD","capitulo_codigo":""}. "valor" es el total pagado (número sin ' +
    'puntos). "concepto": 3 a 8 palabras (qué se compró y a quién si se ve). "capitulo_codigo" de esta lista:\n' +
    capitulos.map((c) => `${c.codigo} = ${c.nombre}`).join('\n') +
    (texto ? `\nTexto de quien lo envió: "${texto}"` : '')
  );
}

// Ajusta ítems e impuesto para que la OC dé EXACTAMENTE el total pagado.
function cuadrarConTotal(l) {
  const items = (l.items || [])
    .map((i) => ({
      descripcion: String(i.descripcion || '').slice(0, 300) || 'Ítem',
      unidad: i.unidad || 'Un',
      cantidad: Number(i.cantidad) > 0 ? Number(i.cantidad) : 1,
      valor_unitario: Math.max(Number(i.valor_unitario) || 0, 0),
    }))
    .filter((i) => i.valor_unitario > 0);
  const total = Number(l.total) || 0;
  let descuento = Math.max(Number(l.descuento) || 0, 0);
  let iva = Number(l.iva_porcentaje) || 0;
  if (l.precios_incluyen_iva) iva = 0;
  const suma = () => items.reduce((a, i) => a + i.cantidad * i.valor_unitario, 0);
  const calcular = () => Math.round((suma() - descuento) * (1 + iva / 100) * 100) / 100;
  const nota = [];

  if (items.length === 0 && total > 0) items.push({ descripcion: l.concepto || 'Compra según factura', unidad: 'Glb', cantidad: 1, valor_unitario: total });
  if (total > 0 && Math.abs(calcular() - total) > 2 && iva > 0) {
    // Probar como "IVA incluido en los precios".
    const ivaPrevio = iva; iva = 0;
    if (Math.abs(calcular() - total) > 2) iva = ivaPrevio;
  }
  if (total > 0 && Math.abs(calcular() - total) > 2) {
    const dif = Math.round((total / (1 + iva / 100) + descuento - suma()) * 100) / 100;
    items.push({ descripcion: 'Ajuste para cuadrar con el total de la factura', unidad: 'Glb', cantidad: 1, valor_unitario: dif });
    nota.push(`Se agregó un ajuste de ${pesos(dif)} para que la OC cuadre con el total de la factura. Revisar.`);
  }
  return { items, descuento, iva_porcentaje: iva, total_calculado: calcular(), nota: nota.join(' ') };
}

// ---------- Resúmenes y botones ----------
function tecladoPrincipal(id) {
  return { inline_keyboard: [[
    { text: '✅ Confirmar', callback_data: `c:${id}` },
    { text: '📂 Capítulo', callback_data: `k:${id}` },
    { text: '❌ Descartar', callback_data: `x:${id}` },
  ]] };
}

function tecladoCapitulos(id, capitulos) {
  const filas = [];
  for (let i = 0; i < capitulos.length; i += 2) {
    filas.push(capitulos.slice(i, i + 2).map((c) => ({
      text: `${c.codigo} · ${c.nombre}`.slice(0, 30),
      callback_data: `s:${id}:${c.codigo}`,
    })));
  }
  filas.push([{ text: '↩️ Volver', callback_data: `v:${id}` }]);
  return { inline_keyboard: filas };
}

function resumenBorrador(b) {
  const d = b.datos;
  const cap = d.capitulo_codigo ? `${d.capitulo_codigo} · ${escaparHTML(d.capitulo_nombre || '')}` : '⚠️ <b>sin capítulo</b> (toca 📂)';
  if (b.tipo === 'CAJA_MENOR') {
    return (
      '🧾 <b>Gasto de CAJA MENOR</b>\n' +
      `Concepto: ${escaparHTML(d.concepto)}\n` +
      `Valor: <b>${pesos(d.valor)}</b> · Fecha: ${d.fecha}\n` +
      `Capítulo: ${cap}\n` +
      (b.remitente ? `Enviado por: ${escaparHTML(b.remitente)}\n` : '') +
      '\n¿Lo registro?'
    );
  }
  const lineas = (d.items || []).slice(0, 8).map((i) => `• ${escaparHTML(i.descripcion)} — ${i.cantidad} × ${pesos(i.valor_unitario)}`);
  if ((d.items || []).length > 8) lineas.push(`• … y ${(d.items || []).length - 8} ítems más`);
  return (
    `🧾 <b>Orden de Compra propuesta</b> (${d.tipo_orden === 'SERVICIO' ? 'servicio' : 'compra'})\n` +
    `Proveedor: <b>${escaparHTML(d.proveedor_nombre || 'Sin identificar')}</b>${d.proveedor_nit ? ` · NIT ${escaparHTML(d.proveedor_nit)}` : ''}\n` +
    `Factura: ${escaparHTML(d.numero_factura || '—')} · Fecha: ${d.fecha}\n` +
    lineas.join('\n') + '\n' +
    (Number(d.descuento) > 0 ? `Descuento: −${pesos(d.descuento)}\n` : '') +
    (Number(d.iva_porcentaje) > 0 ? `IVA ${d.iva_porcentaje}%\n` : '') +
    `<b>Total OC: ${pesos(d.total_calculado)}</b>${d.total_factura && Math.abs(d.total_factura - d.total_calculado) > 2 ? ` (factura: ${pesos(d.total_factura)})` : ''}\n` +
    `Capítulo: ${cap}\n` +
    (d.nota ? `⚠️ ${escaparHTML(d.nota)}\n` : '') +
    '\n¿Creo la OC?'
  );
}

// ---------- Mensajes ----------
export async function procesarMensajeFinanzas(supabase, mensaje, proyecto) {
  const chatId = String(mensaje.chat.id);
  const texto = (mensaje.caption || mensaje.text || '').trim();
  const remitente = [mensaje.from?.first_name, mensaje.from?.last_name].filter(Boolean).join(' ') || mensaje.from?.username || null;
  const responder = (html, extra = {}) =>
    telegramFetch('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', reply_to_message_id: mensaje.message_id, ...extra });

  // Comandos
  const comando = (mensaje.text || '').split(/[\s@]/)[0].toLowerCase();
  if (comando === '/ayuda' || comando === '/start' || comando === '/help') return responder(AYUDA);
  if (comando === '/estado') {
    const { data: g } = await supabase.from('caja_menor_gastos').select('valor').eq('proyecto_id', proyecto.id).is('oc_id', null);
    const acum = (g || []).reduce((a, x) => a + Number(x.valor), 0);
    return responder(`💰 Caja menor por legalizar: <b>${pesos(acum)}</b> de ${pesos(proyecto.tope_caja_menor)} (${(g || []).length} gastos).`);
  }
  if (comando === '/cerrarcaja') {
    const { data, error } = await supabase.rpc('legalizar_caja_menor', { p_proyecto: proyecto.id });
    if (error) return responder('❌ No pude legalizar la caja menor: ' + escaparHTML(error.message));
    if (!data?.legalizada) return responder('No hay gastos de caja menor por legalizar.');
    return responder(`✅ Caja menor legalizada en la <b>${data.folio}</b>: ${data.gastos} gastos por ${pesos(data.total)}.`);
  }

  const esCajaMenor = RE_CAJA_MENOR.test(texto);
  const foto = mensaje.photo?.length ? mensaje.photo[mensaje.photo.length - 1] : null;
  const doc = mensaje.document;
  const esImagenDoc = doc && /^image\//.test(doc.mime_type || '');
  const esPDF = doc && doc.mime_type === 'application/pdf';
  const esExcel = doc && /sheet|excel/.test(doc.mime_type || '');

  if (esExcel) {
    return responder('📊 Los cortes de obra en Excel se generan desde la app (módulo de cortes). Por aquí envíame facturas o recibos en foto o PDF.');
  }
  // Mensajes de texto que no son caja menor: conversación normal del grupo, se ignoran.
  if (!foto && !esImagenDoc && !esPDF && !(esCajaMenor && mensaje.text)) return;

  if (!hayGemini()) return responder('⚠️ La lectura automática no está configurada (falta GEMINI_API_KEY en Vercel).');

  const aviso = await responder(esCajaMenor ? '⏳ Registrando gasto de caja menor…' : '⏳ Leyendo el documento…');
  const avisoId = aviso?.result?.message_id;
  const editar = (html, markup) =>
    telegramFetch('editMessageText', { chat_id: chatId, message_id: avisoId, text: html, parse_mode: 'HTML', ...(markup ? { reply_markup: markup } : {}) });

  try {
    const capitulos = await capitulosDelProyecto(supabase, proyecto.id);
    const fecha = fechaColombia(mensaje.date);

    // Soporte (foto o PDF) a Storage privado.
    let soportePath = null;
    let parteArchivo = null;
    const archivoId = foto?.file_id || doc?.file_id;
    if (archivoId) {
      const archivo = await descargarArchivoTelegram(archivoId);
      if (archivo) {
        const mime = esPDF ? 'application/pdf' : (doc?.mime_type || 'image/jpeg');
        const ext = esPDF ? 'pdf' : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        soportePath = `${proyecto.id}/${fecha.slice(0, 7)}/${mensaje.message_id}.${ext}`;
        await supabase.storage.from('soportes-oc').upload(soportePath, archivo.buffer, { contentType: mime, upsert: true });
        parteArchivo = { inline_data: { mime_type: mime, data: archivo.buffer.toString('base64') } };
      }
    }

    const capNota = texto.match(RE_CAPITULO)?.[1] || null;
    let tipo, datos;

    if (esCajaMenor) {
      const lectura = parsearJSON(await llamarGemini(
        [{ text: promptCajaMenor(capitulos, texto) }, ...(parteArchivo ? [parteArchivo] : [])], { json: true }
      ));
      if (!lectura || !(Number(lectura.valor) > 0)) {
        return editar('❌ No pude identificar el valor del gasto. Escribe por ejemplo: <i>CAJA MENOR 25000 transporte cap 7</i>.');
      }
      const cap = capituloPorCodigo(capitulos, capNota || lectura.capitulo_codigo);
      tipo = 'CAJA_MENOR';
      datos = {
        valor: Math.round(Number(lectura.valor)),
        concepto: String(lectura.concepto || 'Gasto de caja menor').slice(0, 200),
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(lectura.fecha || '') ? lectura.fecha : fecha,
        capitulo_id: cap?.id || null, capitulo_codigo: cap?.codigo || null, capitulo_nombre: cap?.nombre || null,
      };
    } else {
      const lectura = parsearJSON(await llamarGemini([{ text: promptFactura(capitulos, texto) }, parteArchivo], { json: true }));
      if (!lectura) return editar('❌ No pude leer el documento (la IA no respondió). Intenta de nuevo en un minuto o envía una foto más nítida.');
      if (lectura.es_documento_de_pago === false) {
        return editar('🤔 Esto no parece una factura o comprobante de pago. Si es un gasto sin factura, reenvíalo con la nota <b>CAJA MENOR</b>.');
      }
      const cuadre = cuadrarConTotal(lectura);
      const cap = capituloPorCodigo(capitulos, capNota || lectura.capitulo_codigo);
      tipo = 'OC';
      datos = {
        tipo_orden: lectura.tipo_orden === 'SERVICIO' ? 'SERVICIO' : 'COMPRA',
        proveedor_nombre: String(lectura.proveedor_nombre || '').slice(0, 200),
        proveedor_nit: String(lectura.proveedor_nit || '').slice(0, 30),
        numero_factura: String(lectura.numero_factura || '').slice(0, 60),
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(lectura.fecha || '') ? lectura.fecha : fecha,
        concepto: String(lectura.concepto || '').slice(0, 200),
        items: cuadre.items,
        descuento: cuadre.descuento,
        iva_porcentaje: cuadre.iva_porcentaje,
        total_factura: Number(lectura.total) || null,
        total_calculado: cuadre.total_calculado,
        nota: cuadre.nota || null,
        capitulo_id: cap?.id || null, capitulo_codigo: cap?.codigo || null, capitulo_nombre: cap?.nombre || null,
      };
    }

    const { data: borrador, error } = await supabase.from('telegram_borradores').insert({
      proyecto_id: proyecto.id, chat_id: chatId, tipo, datos, soporte_path: soportePath, remitente,
      mensaje_id: mensaje.message_id, bot_mensaje_id: avisoId,
    }).select().single();
    if (error) throw error;
    await editar(resumenBorrador(borrador), tecladoPrincipal(borrador.id));
  } catch (e) {
    console.error('Bot finanzas:', e);
    await editar('❌ Ocurrió un error procesando el documento: ' + escaparHTML(e.message || String(e)));
  }
}

// ---------- Botones ----------
export async function procesarCallbackFinanzas(supabase, cb) {
  const [accion, id, extra] = String(cb.data || '').split(':');
  const chatId = String(cb.message?.chat?.id || '');
  const msgId = cb.message?.message_id;
  const contestar = (texto) => telegramFetch('answerCallbackQuery', { callback_query_id: cb.id, ...(texto ? { text: texto } : {}) });
  const editar = (html, markup) =>
    telegramFetch('editMessageText', { chat_id: chatId, message_id: msgId, text: html, parse_mode: 'HTML', ...(markup ? { reply_markup: markup } : {}) });

  const { data: b } = await supabase.from('telegram_borradores').select('*').eq('id', id).maybeSingle();
  if (!b || b.chat_id !== chatId) return contestar('Este registro ya no existe.');
  if (b.estado !== 'PENDIENTE') return contestar(b.estado === 'CONFIRMADO' ? 'Ya fue registrado.' : 'Ya fue descartado.');

  const quien = cb.from?.first_name || cb.from?.username || 'alguien';
  const { data: proyecto } = await supabase.from('proyectos').select('id, tope_caja_menor').eq('id', b.proyecto_id).single();
  const capitulos = await capitulosDelProyecto(supabase, b.proyecto_id);

  if (accion === 'x') {
    await supabase.from('telegram_borradores').update({ estado: 'DESCARTADO' }).eq('id', id);
    await contestar('Descartado');
    return editar(resumenBorrador(b).replace(/\n\n¿(Creo la OC|Lo registro)\?$/, '') + `\n\n❌ <i>Descartado por ${escaparHTML(quien)}</i>`);
  }
  if (accion === 'k') { await contestar(); return editar(resumenBorrador(b) + '\n\n📂 Elige el capítulo:', tecladoCapitulos(id, capitulos)); }
  if (accion === 'v') { await contestar(); return editar(resumenBorrador(b), tecladoPrincipal(id)); }
  if (accion === 's') {
    const cap = capituloPorCodigo(capitulos, extra);
    if (!cap) return contestar('Capítulo no encontrado');
    const datos = { ...b.datos, capitulo_id: cap.id, capitulo_codigo: cap.codigo, capitulo_nombre: cap.nombre };
    await supabase.from('telegram_borradores').update({ datos }).eq('id', id);
    await contestar(`Capítulo ${cap.codigo}`);
    return editar(resumenBorrador({ ...b, datos }), tecladoPrincipal(id));
  }
  if (accion === 'c') {
    if (!b.datos.capitulo_id) {
      await contestar('Primero elige el capítulo');
      return editar(resumenBorrador(b) + '\n\n📂 Elige el capítulo:', tecladoCapitulos(id, capitulos));
    }
    const base = resumenBorrador(b).replace(/\n\n¿(Creo la OC|Lo registro)\?$/, '');
    if (b.tipo === 'OC') {
      const { data, error } = await supabase.rpc('bot_crear_oc', { p_borrador: id });
      if (error) { await contestar('Error'); return editar(base + '\n\n❌ No se pudo crear la OC: ' + escaparHTML(error.message)); }
      if (data?.duplicado) { await contestar('Factura duplicada'); return editar(base + `\n\n⚠️ Esta factura ya está registrada en la <b>${data.folio}</b>. No se creó otra OC.`); }
      await contestar(`${data.folio} creada`);
      return editar(base + `\n\n✅ <b>${data.folio}</b> creada por Residente C · ${pesos(data.total)} · confirmó ${escaparHTML(quien)}`);
    }
    const { data, error } = await supabase.rpc('bot_registrar_caja_menor', { p_borrador: id });
    if (error) { await contestar('Error'); return editar(base + '\n\n❌ No se pudo registrar: ' + escaparHTML(error.message)); }
    await contestar('Registrado');
    const leg = data?.legalizacion;
    return editar(
      base + `\n\n✅ Registrado por ${escaparHTML(quien)}. Caja menor acumulada: <b>${pesos(data.acumulado)}</b> de ${pesos(data.tope)}.` +
      (leg?.legalizada ? `\n📑 Se alcanzó el tope: caja menor legalizada en la <b>${leg.folio}</b> (${leg.gastos} gastos, ${pesos(leg.total)}).` : '')
    );
  }
  return contestar();
}
