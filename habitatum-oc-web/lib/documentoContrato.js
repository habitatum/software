// ============================================================
// Documento del contrato estándar con contratista (059) — lógica compartida entre el
// formulario, la vista previa y el PDF. El TEXTO sale solo de la plantilla guardada en la
// base de datos (contrato_plantillas.contenido = JSON oficial); aquí solo se arman los
// datos variables, los cálculos y el orden de impresión.
// ============================================================
import { calcularImpuestos } from './calculosOC';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const NOMBRE_REGIMEN = { SIN_IVA: 'Sin IVA', IVA: 'IVA', AIU: 'AIU', IVA_UTILIDAD: 'IVA sobre la utilidad' };

// Plantilla de obras TODO COSTO (067): HABITATUM es el Contratante; no hay propietarios en el documento.
export const esTodoCosto = (datos) => !!datos?.plantilla?.contenido?.contratante_fijo;

export const txt = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const redondear = (n) => Math.round(Number(n) || 0);

// "19 de octubre de 2026" (mes en minúscula).
export function fechaLarga(f) {
  if (!f) return '';
  const [a, m, d] = String(f).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '';
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function pctTexto(p) {
  const n = Math.round(num(p) * 100) / 100;
  return `${n.toLocaleString('es-CO')} %`;
}

// ---------- Número en letras (español, mayúsculas) ----------
const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE',
  'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS',
  'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function menorMil(n, apocope) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100), r = n % 100;
  let s = c ? CENTENAS[c] : '';
  let r2 = '';
  if (r > 0 && r < 30) r2 = UNIDADES[r];
  else if (r >= 30) r2 = DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : '');
  // "UN" / "VEINTIÚN" / "Y UN" antes de MIL o MILLONES.
  if (apocope) r2 = r2.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
  return [s, r2].filter(Boolean).join(' ');
}

function menorMillon(n, apocope) {
  const miles = Math.floor(n / 1000), resto = n % 1000;
  const partes = [];
  if (miles === 1) partes.push('MIL');
  else if (miles > 1) partes.push(`${menorMil(miles, true)} MIL`);
  if (resto) partes.push(menorMil(resto, apocope));
  return partes.join(' ');
}

export function numeroEnLetras(valor) {
  let n = Math.round(Math.abs(Number(valor) || 0));
  if (n === 0) return 'CERO';
  const partes = [];
  const billones = Math.floor(n / 1e12); n %= 1e12;
  const millones = Math.floor(n / 1e6); const resto = n % 1e6;
  if (billones) partes.push(billones === 1 ? 'UN BILLÓN' : `${menorMillon(billones, true)} BILLONES`);
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${menorMillon(millones, true)} MILLONES`);
  if (resto) partes.push(menorMillon(resto, false));
  return partes.join(' ');
}

// "... PESOS M/CTE. El valor definitivo resulta de las cantidades ejecutadas."
// Cifras redondas en millones llevan "DE" (UN MILLÓN DE PESOS).
export function valorEnLetras(valor) {
  const n = Math.round(Math.abs(Number(valor) || 0));
  const letras = numeroEnLetras(n);
  const de = n > 0 && n % 1e6 === 0 ? ' DE' : '';
  return `${letras}${de} PESOS M/CTE. El valor definitivo resulta de las cantidades ejecutadas.`;
}

// ---------- Valores por defecto de la plantilla ----------
export function defectoCampo(plantilla, clave) {
  for (const s of plantilla?.condiciones_particulares || []) {
    for (const c of s.campos) if (c.clave === clave) return c.valor_por_defecto;
  }
  return undefined;
}

export function textoRegimenProveedor(prov) {
  const r = prov?.regimen_iva === 'RESPONSABLE' ? 'Responsable de IVA' : prov?.regimen_iva === 'NO_RESPONSABLE' ? 'No responsable de IVA' : '';
  const s = prov?.soporte_cobro === 'FACTURA' ? 'Factura electrónica a nombre del Contratante'
    : prov?.soporte_cobro === 'CUENTA_COBRO' ? 'Cuenta de cobro a nombre del Contratante' : '';
  return [r, s].filter(Boolean).join(' · ');
}

/**
 * Estado inicial del formulario: el borrador guardado o, si no hay, la precarga desde el
 * proyecto, el proveedor y los valores por defecto de la plantilla.
 */
export function precargar(datos) {
  const P = datos?.plantilla?.contenido || {};
  const def = (k) => defectoCampo(P, k);
  const doc = datos?.documento;
  const pro = datos?.proyecto || {};
  const prov = datos?.proveedor || {};
  const props = Array.isArray(datos?.propietarios) ? datos.propietarios : [];
  const p0 = props[0] || {};
  const referencias = (datos?.items || []).filter((i) => i.referencia).map((i) => i.id);
  if (doc) {
    return {
      campos: { ...doc.campos }, contratante: doc.contratante || [], regimen: doc.regimen,
      pct_a: doc.pct_a, pct_i: doc.pct_i, pct_u: doc.pct_u, pct_iva: doc.pct_iva,
      anticipo_pct: doc.anticipo_pct, retencion_pct: doc.retencion_pct,
      garantias: unirGarantias(P, doc.garantias), obligaciones: doc.obligaciones || [],
      fecha_firma: doc.fecha_firma || '', referencias,
      precios_con_iva: !!doc.precios_con_iva, anexos_integrales: Array.isArray(doc.anexos_integrales) ? doc.anexos_integrales : [],
    };
  }
  if (esTodoCosto(datos)) return precargarTodoCosto(datos, P, def, pro, prov, referencias);
  return {
    campos: {
      contratante_direccion: txt(p0.direccion), contratante_telefono: txt(p0.telefono), contratante_correo: txt(p0.correo),
      contratista_nombre: txt(prov.nombre), contratista_identificacion: txt(prov.nit),
      contratista_tipo_persona: prov.tipo_persona || 'NATURAL',
      contratista_rep_legal: txt(prov.representante_legal), contratista_cc_rep: txt(prov.cc_representante),
      contratista_direccion: txt(prov.direccion), contratista_telefono: txt(prov.telefono), contratista_correo: txt(prov.correo),
      contratista_regimen: textoRegimenProveedor(prov), encargado_obra: '',
      admin_director: txt(pro.director_obra) || def('admin_director') || '',
      proyecto_nombre: txt(pro.nombre), proyecto_ubicacion: [txt(pro.direccion_obra), txt(pro.ciudad)].filter(Boolean).join(', '),
      actividad: txt(datos?.contrato?.concepto), alcance: txt(datos?.contrato?.alcance_detallado),
      cortes_pagos: def('cortes_pagos') || '', medio_pago: def('medio_pago') || '',
      plazo: def('plazo') || '', horario: txt(pro.horario_obra) || def('horario') || '',
      garantia: def('garantia') || '', reclamos: def('reclamos') || '',
      lugar_firma: txt(pro.ciudad), domicilio: txt(pro.ciudad),
    },
    contratante: props.map((o) => ({ ...o })),
    regimen: prov.regimen_iva === 'RESPONSABLE' ? 'IVA' : 'SIN_IVA',
    pct_a: 0, pct_i: 0, pct_u: 0, pct_iva: 19,
    anticipo_pct: num(datos?.contrato?.pct_anticipo), retencion_pct: num(def('retencion_pct')) * 100 || 10,
    garantias: unirGarantias(P, []), obligaciones: [], fecha_firma: datos?.contrato?.fecha_contrato || '', referencias,
    precios_con_iva: false, anexos_integrales: [],
  };
}

const capitalizar = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

// "Noventa y siete (97) días calendario contados a partir del 26 de octubre de 2026"
export function textoPlazo(contrato) {
  const n = num(contrato?.plazo_valor);
  const u = txt(contrato?.plazo_unidad);
  if (!n || !u) return '';
  const desde = contrato?.fecha_inicio ? `a partir del ${fechaLarga(contrato.fecha_inicio)}` : 'a partir de la firma del Contrato';
  return `${capitalizar(numeroEnLetras(n))} (${n}) ${u} contados ${desde}`;
}

export function textoGarantia(meses) {
  const n = num(meses);
  if (!n) return '';
  return `${capitalizar(numeroEnLetras(n))} (${n}) ${n === 1 ? 'mes' : 'meses'} contados desde el Acta de Recibo Final`;
}

function precargarTodoCosto(datos, P, def, pro, prov, referencias) {
  const k = datos?.contrato || {};
  const responsable = prov.regimen_iva === 'RESPONSABLE';
  return {
    campos: {
      contratante_rep_legal: P.contratante_fijo?.rep_legal || '', contratante_cc_rep: '',
      director_obra: txt(pro.director_obra) || def('director_obra') || '',
      contratista_nombre: txt(prov.nombre), contratista_identificacion: txt(prov.nit),
      contratista_tipo_persona: prov.tipo_persona || 'NATURAL',
      contratista_rep_legal: txt(prov.representante_legal), contratista_cc_rep: txt(prov.cc_representante),
      contratista_direccion: txt(prov.direccion), contratista_telefono: txt(prov.telefono), contratista_correo: txt(prov.correo),
      contratista_regimen: textoRegimenProveedor(prov), encargado_obra: '',
      proyecto_nombre: txt(pro.nombre), proyecto_ubicacion: [txt(pro.direccion_obra), txt(pro.ciudad)].filter(Boolean).join(', '),
      actividad: txt(k.concepto), alcance: txt(k.alcance_detallado), suministros_contratante: '',
      cortes_pagos: def('cortes_pagos') || '', medio_pago: def('medio_pago') || '',
      plazo: textoPlazo(k) || def('plazo') || '', horario: txt(pro.horario_obra) || def('horario') || '',
      garantia: textoGarantia(k.garantia_meses) || def('garantia') || '', reclamos: def('reclamos') || '',
      lugar_firma: txt(pro.ciudad), domicilio: txt(pro.ciudad),
    },
    contratante: [],
    regimen: responsable ? 'IVA' : 'SIN_IVA',
    pct_a: 0, pct_i: 0, pct_u: 0, pct_iva: 19,
    anticipo_pct: num(k.pct_anticipo), retencion_pct: num(def('retencion_pct')) * 100 || 10,
    garantias: unirGarantias(P, []), obligaciones: [], fecha_firma: k.fecha_contrato || '', referencias,
    precios_con_iva: responsable, anexos_integrales: [],
  };
}

// Las 6 opciones de la plantilla con lo guardado encima (activa, % y vigencia editables).
export function unirGarantias(P, guardadas) {
  const g = Object.fromEntries((guardadas || []).map((x) => [x.clave, x]));
  return (P?.garantias_exigidas?.opciones || []).map((o) => ({
    clave: o.clave,
    activa: g[o.clave] ? !!g[o.clave].activa : !!o.activa_por_defecto,
    pct: g[o.clave] && g[o.clave].pct !== undefined ? num(g[o.clave].pct) : num(o.pct) * 100,
    vigencia: g[o.clave] && g[o.clave].vigencia !== undefined ? g[o.clave].vigencia : o.vigencia,
  }));
}

// ---------- Cálculos (misma función de impuestos de la app) ----------
// Cuánto pesa el IVA (y el AIU) sobre el subtotal: sirve para quitarlo de precios que ya lo traen.
export function factorRegimen(f) {
  const iva = num(f?.pct_iva) / 100, a = num(f?.pct_a) / 100, i = num(f?.pct_i) / 100, u = num(f?.pct_u) / 100;
  if (f?.regimen === 'IVA') return 1 + iva;
  if (f?.regimen === 'IVA_UTILIDAD') return 1 + u * iva;
  if (f?.regimen === 'AIU') return 1 + a + i + u + u * iva;
  return 1;
}

// Ítems tal como se imprimen: si los precios del contrato ya traen el IVA (precios_con_iva), el
// documento los presenta sin IVA (valor unitario ÷ factor) y el IVA va aparte. No cambia los ítems guardados.
export function itemsDocumento(items, f) {
  const factor = f?.precios_con_iva ? factorRegimen(f) : 1;
  return (items || []).map((i) => {
    const vu = factor !== 1 ? num(i.valor_unitario) / factor : num(i.valor_unitario);
    const total = factor !== 1 ? redondear(num(i.cantidad) * vu) : num(i.cantidad) * vu;
    return { ...i, valor_unitario: vu, total };
  });
}

export function calcular(items, f) {
  const lista = itemsDocumento(items, f).filter((i) => !(f?.referencias || []).includes(i.id));
  const subtotal = redondear(lista.reduce((a, i) => a + i.total, 0));
  const tipo = f?.regimen === 'AIU' ? 'CON_AIU' : f?.regimen === 'IVA' ? 'CON_IVA' : 'SIN_IVA';
  const imp = calcularImpuestos({
    tipo_impuesto: tipo, porcentaje_iva: num(f?.pct_iva), porcentaje_administracion: num(f?.pct_a),
    porcentaje_imprevistos: num(f?.pct_i), porcentaje_utilidad: num(f?.pct_u),
  }, subtotal);
  if (f?.regimen === 'IVA_UTILIDAD') {
    // IVA sobre la utilidad (todo costo): base gravable = % utilidad × subtotal; no se suma la utilidad.
    imp.base_gravable = redondear(subtotal * num(f?.pct_u) / 100);
    imp.valor_iva = redondear(subtotal * num(f?.pct_u) / 100 * num(f?.pct_iva) / 100);
  }
  const total = redondear(subtotal + imp.valor_aiu + imp.valor_iva);
  const anticipo = redondear(total * num(f?.anticipo_pct) / 100);
  return { subtotal, ...imp, total, anticipo };
}

// ---------- Validaciones ----------
export function validar(datos, f, smmlv) {
  const errores = []; const avisos = [];
  const c = f.campos || {};
  if (esTodoCosto(datos)) {
    if (!txt(c.contratante_rep_legal) || !txt(c.contratante_cc_rep)) errores.push('Falta el representante legal de HABITATUM o su cédula.');
    if (f.regimen === 'IVA_UTILIDAD' && !(num(f.pct_u) > 0)) errores.push('Indique el % de utilidad gravable del régimen IVA sobre la utilidad.');
  } else if (!f.contratante?.length) errores.push('Agregue al menos un propietario (Contratante).');
  else if (f.contratante.some((o) => !txt(o.nombre) || !txt(o.identificacion))) errores.push('Cada propietario necesita nombre e identificación.');
  if (!txt(c.contratista_nombre) || !txt(c.contratista_identificacion)) errores.push('Falta el nombre o la identificación del Contratista.');
  if (!txt(c.proyecto_nombre) || !txt(c.proyecto_ubicacion)) errores.push('Falta el proyecto o la ubicación.');
  if (!txt(c.actividad)) errores.push('Falta la actividad.');
  if (!txt(c.alcance)) errores.push('Falta el alcance.');
  if (!txt(c.plazo)) errores.push('Falta el plazo.');
  if (!txt(c.lugar_firma) || !f.fecha_firma) errores.push('Falta el lugar o la fecha de firma.');
  const conValor = (datos?.items || []).filter((i) => !f.referencias.includes(i.id) && num(i.cantidad) > 0 && num(i.valor_unitario) > 0);
  if (!conValor.length) errores.push('Se necesita al menos un ítem con cantidad y valor (Ítems del contrato).');
  const marcadores = Object.entries(c).filter(([, v]) => /\[[^\]]*\]/.test(String(v || ''))).map(([k]) => k);
  if (marcadores.length) errores.push(`Reemplace los marcadores [ ] en: ${marcadores.join(', ')}.`);

  const al = String(c.alcance || '');
  if (al && (!/INCLUYE:/.test(al.replace(/NO INCLUYE:/g, '')) || !/NO INCLUYE:/.test(al))) avisos.push('El alcance no tiene "INCLUYE:" y "NO INCLUYE:".');
  const t = calcular(datos?.items, f);
  const activas = (f.garantias || []).filter((g) => g.activa);
  if (smmlv && activas.length && t.total < 20 * smmlv) avisos.push(`Hay garantías activas en un contrato menor a 20 SMMLV (${(20 * smmlv).toLocaleString('es-CO')}).`);
  if (!smmlv && activas.length) avisos.push('No está configurado el SMMLV: no se puede revisar el tope de 20 SMMLV para las garantías.');
  if (num(f.anticipo_pct) > 0 && !activas.some((g) => g.clave === 'cumplimiento')) avisos.push('Hay anticipo y la póliza de cumplimiento no está activa.');
  return { errores, avisos };
}

// ---------- Modelo de impresión (lo usa el PDF; también sirve para la vista previa) ----------
function parteContratante(P, o) {
  const tpl = o.tipo_persona === 'JURIDICA' ? P.partes.contratante_persona_juridica : P.partes.contratante_persona_natural;
  return tpl.replace('{{NOMBRE_MAYUSCULAS}}', txt(o.nombre).toUpperCase()).replace('{{RAZON_SOCIAL}}', txt(o.nombre).toUpperCase())
    .replace('{{cedula}}', txt(o.identificacion)).replace('{{nit}}', txt(o.identificacion))
    .replace('{{rep_legal}}', txt(o.representante_legal).toUpperCase()).replace('{{cc_rep_legal}}', txt(o.cc_representante));
}

export function unirConY(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
}

export function textoPartes(P, f) {
  const c0 = f.campos || {};
  if (P.contratante_fijo) {
    return P.partes.plantilla.replace('{{rep_legal_habitatum}}', txt(c0.contratante_rep_legal).toUpperCase())
      .replace('{{cc_rep_legal_habitatum}}', txt(c0.contratante_cc_rep))
      .replace('{{contratista_identificacion}}', textoContratista(P, c0));
  }
  const props = f.contratante || [];
  const unidos = unirConY(props.map((o) => parteContratante(P, o)));
  const sufijo = props.length > 1
    ? ', quienes obran en nombre propio como propietarios del predio donde se ejecuta la Obra y responden solidariamente por las obligaciones a su cargo'
    : ', quien obra en nombre propio como propietario(a) del predio donde se ejecuta la Obra';
  return P.partes.plantilla.replace('{{contratante_identificacion}}', unidos + sufijo).replace('{{contratista_identificacion}}', textoContratista(P, f.campos || {}));
}

function textoContratista(P, c) {
  const tplC = c.contratista_tipo_persona === 'JURIDICA' ? P.partes.contratista_persona_juridica : P.partes.contratista_persona_natural;
  return tplC.replace('{{NOMBRE_MAYUSCULAS}}', txt(c.contratista_nombre).toUpperCase())
    .replace('{{RAZON_SOCIAL}}', txt(c.contratista_nombre).toUpperCase())
    .replace('{{cedula}}', txt(c.contratista_identificacion)).replace('{{nit}}', txt(c.contratista_identificacion))
    .replace('{{rep_legal}}', txt(c.contratista_rep_legal).toUpperCase()).replace('{{cc_rep_legal}}', txt(c.contratista_cc_rep));
}

const REGIMEN_TEXTO = {
  SIN_IVA: 'Sin IVA (no responsable de IVA)',
  IVA: (f) => `IVA ${pctTexto(f.pct_iva)} sobre el subtotal`,
  AIU: (f) => `AIU: Administración ${pctTexto(f.pct_a)}, Imprevistos ${pctTexto(f.pct_i)}, Utilidad ${pctTexto(f.pct_u)}; IVA ${pctTexto(f.pct_iva)} solo sobre la Utilidad`,
  IVA_UTILIDAD: (f) => `IVA ${pctTexto(f.pct_iva)} sobre la utilidad (base gravable: ${pctTexto(f.pct_u)} del subtotal)`,
};

/** Arma todo lo que se imprime. `datos` = documento_contrato_datos (o la foto fija); `f` = formulario. */
export function modeloDocumento(datos, f) {
  const P = datos.plantilla.contenido;
  const c = f.campos || {};
  const items = itemsDocumento(datos.items || [], f);
  const esRef = (i) => (f.referencias || []).includes(i.id);
  const tc = !!P.contratante_fijo;
  const t = calcular(datos.items || [], f); // con los ítems originales (calcular quita el IVA si aplica)
  const pesos = (v) => `$ ${redondear(v).toLocaleString('es-CO')}`;
  const valores = {
    contratante_nombre: (f.contratante || []).map((o) => txt(o.nombre)).filter(Boolean).join(' y '),
    contratante_direccion: c.contratante_direccion, contratante_telefono: c.contratante_telefono, contratante_correo: c.contratante_correo,
    contratista_nombre: c.contratista_nombre, contratista_direccion: c.contratista_direccion, contratista_telefono: c.contratista_telefono,
    contratista_correo: c.contratista_correo, contratista_regimen: c.contratista_regimen, encargado_obra: c.encargado_obra,
    admin_director: c.admin_director,
    contratante_rep: tc ? [txt(c.contratante_rep_legal), txt(c.contratante_cc_rep) ? `C.C. ${txt(c.contratante_cc_rep)}` : ''].filter(Boolean).join(' · ') : '',
    director_obra: c.director_obra, suministros_contratante: c.suministros_contratante,
    anexos_integrales: (f.anexos_integrales || []).map(txt).filter(Boolean).map((a, i) => `${i + 1}. ${a}`).join('\n'),
    subtotal: pesos(t.subtotal),
    impuesto: f.regimen === 'IVA_UTILIDAD' ? `${pesos(t.valor_iva)} (${pctTexto(f.pct_iva)} sobre la base gravable de ${pesos(t.base_gravable)}, ${pctTexto(f.pct_u)} del subtotal)`
      : f.regimen === 'IVA' ? `${pesos(t.valor_iva)} (${pctTexto(f.pct_iva)} sobre el subtotal)`
      : f.regimen === 'AIU' ? `AIU ${pesos(t.valor_aiu)} + IVA ${pesos(t.valor_iva)} (${pctTexto(f.pct_iva)} sobre la utilidad)` : '',
    proyecto_nombre: c.proyecto_nombre, proyecto_ubicacion: c.proyecto_ubicacion,
    actividad: c.actividad, alcance: c.alcance,
    valor: pesos(t.total), valor_letras: valorEnLetras(t.total),
    regimen: typeof REGIMEN_TEXTO[f.regimen] === 'function' ? REGIMEN_TEXTO[f.regimen](f) : REGIMEN_TEXTO[f.regimen],
    anticipo_pct: pctTexto(f.anticipo_pct), anticipo_valor: num(f.anticipo_pct) > 0 ? pesos(t.anticipo) : '',
    retencion_pct: pctTexto(f.retencion_pct), cortes_pagos: c.cortes_pagos, medio_pago: c.medio_pago,
    plazo: c.plazo, horario: c.horario, garantia: c.garantia, reclamos: c.reclamos,
    lugar_fecha: [txt(c.lugar_firma), fechaLarga(f.fecha_firma)].filter(Boolean).join(', '),
    domicilio: c.domicilio,
  };
  const secciones = P.condiciones_particulares.map((s) => ({
    titulo: s.seccion,
    filas: s.campos.map((cp) => {
      const v = cp.tipo === 'fijo' ? cp.valor_por_defecto : valores[cp.clave];
      return { etiqueta: cp.etiqueta, valor: txt(v), largo: cp.tipo === 'texto_largo' };
    }).filter((x) => x.valor !== ''), // regla: campo vacío = fila omitida
  }));
  const opciones = Object.fromEntries((P.garantias_exigidas.opciones || []).map((o) => [o.clave, o]));
  const garantias = (f.garantias || []).filter((g) => g.activa && opciones[g.clave]).map((g) => {
    const o = opciones[g.clave];
    const base = g.clave === 'anticipo' ? t.anticipo : t.total;
    return { amparo: o.amparo, pct: pctTexto(g.pct), base: o.base, valor: pesos(base * num(g.pct) / 100), vigencia: txt(g.vigencia) };
  });
  const firmantesContratante = tc ? [{
    rol: 'EL CONTRATANTE', nombre: txt(P.contratante_fijo.razon_social), id: `NIT ${txt(P.contratante_fijo.nit)}`,
    extra: `Rep. legal: ${txt(c.contratante_rep_legal)}${txt(c.contratante_cc_rep) ? ` · C.C. ${txt(c.contratante_cc_rep)}` : ''}`,
  }] : (f.contratante || []).map((o) => ({
    rol: 'EL CONTRATANTE', nombre: txt(o.nombre).toUpperCase(),
    id: `${o.tipo_persona === 'JURIDICA' ? 'NIT' : 'C.C.'} ${txt(o.identificacion)}`,
    extra: o.tipo_persona === 'JURIDICA' && txt(o.representante_legal) ? `Rep. legal: ${txt(o.representante_legal)}` : '',
  }));
  const firmanteContratista = {
    rol: 'EL CONTRATISTA', nombre: txt(c.contratista_nombre).toUpperCase(),
    id: `${c.contratista_tipo_persona === 'JURIDICA' ? 'NIT' : 'C.C.'} ${txt(c.contratista_identificacion)}`,
    extra: c.contratista_tipo_persona === 'JURIDICA' && txt(c.contratista_rep_legal) ? `Rep. legal: ${txt(c.contratista_rep_legal)}` : '',
  };
  // Como el contrato firmado: 1ª fila propietario principal + contratista; luego los demás propietarios.
  const firmas = firmantesContratante.length ? [firmantesContratante[0], firmanteContratista, ...firmantesContratante.slice(1)] : [firmanteContratista];

  const titulo = P.documento.titulo.replace('{{actividad_mayusculas}}', txt(datos.contrato?.concepto || c.actividad).toUpperCase());
  const numero = txt(datos.contrato?.numero_contrato);
  return {
    P, t, numero, titulo, subtitulo: P.documento.subtitulo.replace('{{numero_contrato}}', numero),
    proyecto: txt(c.proyecto_nombre), municipio: txt(c.domicilio),
    partes: textoPartes(P, f), secciones, garantias, firmas, firmantesContratante, firmanteContratista,
    itemsA: items.filter((i) => !esRef(i)), itemsB: items.filter(esRef),
    regimen: f.regimen, pct: { a: num(f.pct_a), i: num(f.pct_i), u: num(f.pct_u), iva: num(f.pct_iva) },
    obligaciones: (f.obligaciones || []).map(txt).filter(Boolean),
  };
}
