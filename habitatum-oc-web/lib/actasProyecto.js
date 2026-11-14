// 081 · Acta de inicio y Acta de entrega de obra (pestaña Contratos, solo admin).
// Lo que se llena en el formulario se guarda en actas_proyecto.datos; el PDF sale de lib/PlantillaActaPDF.js.

export const CONDICIONES_INICIO = [
  { k: 'contrato', t: 'Contrato firmado por las partes', na: false },
  { k: 'presupuesto', t: 'Presupuesto y alcance aprobados por el contratante', na: false },
  { k: 'anticipo', t: 'Anticipo recibido', na: true },
  { k: 'inmueble', t: 'Entrega del inmueble / acceso al sitio de obra', na: false },
  { k: 'planos', t: 'Planos, diseños y especificaciones entregados', na: true },
  { k: 'permisos', t: 'Permisos de la copropiedad / licencias requeridas', na: true },
  { k: 'polizas', t: 'Pólizas exigidas en el contrato', na: true },
  { k: 'servicios', t: 'Servicios públicos disponibles (agua, energía)', na: false },
];

export const DOCUMENTOS_ENTREGA = [
  { k: 'manual', t: 'Manual de uso y mantenimiento del inmueble' },
  { k: 'garantias', t: 'Garantías de fabricantes y proveedores (equipos, griferías, aparatos)' },
  { k: 'planos', t: 'Planos record / esquemas de redes (si aplica)' },
  { k: 'llaves', t: 'Llaves, controles y accesorios' },
  { k: 'fotos', t: 'Registro fotográfico final' },
];

export const MODALIDAD = { TODO_COSTO: 'Todo costo', ADMINISTRACION_DELEGADA: 'Administración delegada' };

// Datos iniciales del formulario a partir del proyecto (y, para la entrega, del acta de inicio guardada).
export function datosIniciales({ tipo, proyecto, inicio, capitulos, cobro, avance }) {
  const marca = proyecto.mostrar_marca_habitatum !== false;
  const base = {
    numero: '01',
    fecha_acta: new Date().toISOString().slice(0, 10),
    direccion: proyecto.direccion_obra || '',
    ciudad: proyecto.ciudad || '',
    cliente: proyecto.cliente || '',
    nit_cliente: '',
    rep_cliente: '',
    contratista: marca ? 'HABITATUM S.A.S.' : (proyecto.nombre_emisor || ''),
    nit_contratista: marca ? '900.896.011-0' : '',
    rep_contratista: marca ? 'Andrés David Hincapié Cadavid' : (proyecto.nombre_emisor || ''),
    contrato_no: '',
    objeto: '',
    valor: cobro?.contrato?.valor ? String(Math.round(cobro.contrato.valor)) : '',
    director: proyecto.director_obra || '',
    observaciones: '',
  };
  if (tipo === 'INICIO') {
    return {
      ...base, plazo: '', inicio: '', fin: '', horario: proyecto.horario_obra || '', anticipo_valor: '', anticipo_fecha: '',
      condiciones: Object.fromEntries(CONDICIONES_INICIO.map((c) => [c.k, ''])),
    };
  }
  const i = inicio || {};
  ['direccion', 'ciudad', 'cliente', 'nit_cliente', 'rep_cliente', 'contratista', 'nit_contratista', 'rep_contratista', 'contrato_no', 'objeto', 'valor', 'director']
    .forEach((k) => { if (i[k]) base[k] = i[k]; });
  return {
    ...base,
    inicio: i.inicio || '', fin_prevista: i.fin || '', prorrogas: '', fin_real: '',
    capitulos: (capitulos || []).map((c) => ({ codigo: c.codigo, nombre: c.nombre, pct: String(avance?.[c.codigo] ?? 100), estado: '' })),
    adicionales: cobro?.adicionales?.valor ? String(Math.round(cobro.adicionales.valor)) : '0',
    deductivos: '0',
    pagos: cobro ? String(Math.round(Number(cobro.contrato?.pagado || 0) + Number(cobro.adicionales?.pagado || 0))) : '',
    pendientes: [{ descripcion: '', responsable: '', fecha: '' }],
    documentos: Object.fromEntries(DOCUMENTOS_ENTREGA.map((c) => [c.k, ''])),
    meses_garantia: '',
  };
}
