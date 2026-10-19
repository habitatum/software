'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

// ============================================================
// Caja de proyectos TODO COSTO — solo administradores.
// Todo el cálculo vive en la función SQL caja_proyecto(proyecto), que además
// rechaza a cualquier usuario que no sea admin (RLS + chequeo explícito).
// ============================================================

const hoy = () => new Date().toISOString().slice(0, 10);
const CAMPO = 'border rounded px-3 py-2 text-sm w-full';
const TIPOS = { INGRESO_CLIENTE: 'Ingreso del cliente', RETIRO_UTILIDAD: 'Retiro de utilidad', PAGO_IVA: 'Pago de IVA (DIAN)', AJUSTE: 'Ajuste' };
// Opciones del botón "Registrar movimiento" ("Otro" = ajuste, valor + o −).
const OPCIONES_MOV = [['INGRESO_CLIENTE', 'Ingreso del cliente'], ['RETIRO_UTILIDAD', 'Retiro de utilidad'], ['PAGO_IVA', 'Pago de IVA (DIAN)'], ['AJUSTE', 'Otro (ajuste)']];
// Cómo se agrupan las OC que componen el renglón "Órdenes de Compra" (origen de caja_directa).
const GRUPOS_OC = [['Corte', 'Cortes de obra'], ['OC', 'Compras'], ['Telegram', 'Bot de finanzas'], ['Caja menor', 'Caja menor legalizada']];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (ym) => { const [a, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${a}`; };
const ESTADOS = {
  PAGADO: 'bg-green-100 text-green-800',
  PARCIAL: 'bg-amber-100 text-amber-800',
  VENCIDO: 'bg-red-100 text-red-800',
  PENDIENTE: 'bg-neutral-100 text-neutral-700',
};

function fecha(f) {
  if (!f) return '—';
  const p = String(f).slice(0, 10).split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function Fila({ etiqueta, valor, signo, fuerte, sub, nota, onClick, abierto, color = '' }) {
  return (
    <div className={`py-1.5 ${fuerte ? 'font-semibold border-t border-dorado mt-1 pt-2' : ''}`}>
      <div className={`flex justify-between gap-3 ${sub ? 'pl-4 text-xs text-neutral-500' : 'text-sm'}`}>
        {onClick ? (
          <button type="button" onClick={onClick} className="text-left hover:text-carbon underline decoration-dotted underline-offset-2">
            {abierto ? '▾' : '▸'} {etiqueta}
          </button>
        ) : <span>{etiqueta}</span>}
        <span className={`whitespace-nowrap tabular-nums ${color}`}>{signo === '-' && Number(valor) ? '− ' : signo === '+' ? '+ ' : ''}{formatoPesos(Math.abs(Number(valor) || 0))}</span>
      </div>
      {nota && <p className={`text-[11px] font-normal text-neutral-500 mt-0.5 ${sub ? 'pl-4' : ''}`}>{nota}</p>}
    </div>
  );
}

// Menú desplegable simple (botón + lista), se cierra al elegir.
function Desplegable({ etiqueta, opciones, oscuro, alinear = 'right' }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setAbierto(!abierto)}
        className={`${oscuro ? 'bg-carbon text-hueso' : 'border border-neutral-300 text-neutral-700 bg-white'} px-4 py-2 rounded text-sm`}>
        {etiqueta} ▾
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAbierto(false)} />
          <div className={`absolute ${alinear === 'right' ? 'right-0' : 'left-0'} mt-1 z-20 bg-white border rounded-md shadow-lg min-w-[200px] py-1`}>
            {opciones.map(([clave, texto, accion]) => (
              <button key={clave} type="button" onClick={() => { setAbierto(false); accion(); }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-hueso">{texto}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Caja() {
  const router = useRouter();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mov, setMov] = useState({ tipo: 'INGRESO_CLIENTE', fecha: hoy(), valor: '', concepto: '', beneficiario: '' });
  const [conc, setConc] = useState({ fecha: hoy(), saldo_banco: '', nota: '' });
  const [hito, setHito] = useState({ concepto: '', valor: '', fecha_estimada: '' });
  const [cajaMenor, setCajaMenor] = useState([]);
  // Libro (caja_directa): fuente del desglose de OC y de los egresos del libro.
  const [libro, setLibro] = useState(null);
  const [panel, setPanel] = useState(null); // 'MOV' | 'CONC' | null
  const [verOC, setVerOC] = useState(false);
  const [grupoAbierto, setGrupoAbierto] = useState('');
  const [libroAbierto, setLibroAbierto] = useState(false);
  const [filtroLibro, setFiltroLibro] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [recientesPrimero, setRecientesPrimero] = useState(false);
  // Costo que falta por ejecutar: lo pone el admin según su proyección interna (054).
  const [editCosto, setEditCosto] = useState(null); // null = no editando; string = valor en edición

  const esAdmin = usuario?.rol === 'admin';
  const todoCosto = proyecto?.modelo_contratacion === 'TODO_COSTO';

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data, error: err } = await supabase.rpc('caja_proyecto', { p_proyecto: proyecto.id });
    if (err) setError(err.message);
    setDatos(data || null);
    const { data: cm } = await supabase
      .from('caja_menor_gastos')
      .select('id, fecha, valor, concepto, remitente, presupuesto_capitulos(codigo, nombre)')
      .eq('proyecto_id', proyecto.id).is('oc_id', null).order('fecha').order('creado_en');
    setCajaMenor(cm || []);
    const { data: cd } = await supabase.rpc('caja_directa', { p_proyecto: proyecto.id });
    setLibro(cd || []);
  }

  function legalizarCajaMenor() {
    if (!window.confirm('¿Legalizar ahora la caja menor acumulada en una Orden de Compra?')) return;
    ejecutar(async (s) => {
      const { data, error: e } = await s.rpc('legalizar_caja_menor', { p_proyecto: proyecto.id });
      if (e) throw e;
      if (data?.legalizada) window.alert(`Caja menor legalizada en la ${data.folio} (${data.gastos} gastos, ${formatoPesos(data.total)}).`);
    });
  }
  useEffect(() => { if (esAdmin && todoCosto) cargar(); }, [esAdmin, todoCosto, proyecto?.id]); // eslint-disable-line

  async function ejecutar(fn) {
    setError('');
    setGuardando(true);
    try { await fn(crearClienteSupabase()); await cargar(); }
    catch (e) { setError(e.message || 'No se pudo guardar.'); }
    finally { setGuardando(false); }
  }

  function guardarMovimiento() {
    if (!(Number(mov.valor) > 0) && mov.tipo !== 'AJUSTE') { setError('Escribe un valor mayor a 0.'); return; }
    if (!mov.concepto.trim()) { setError('Escribe el concepto del movimiento.'); return; }
    ejecutar(async (s) => {
      const { error: e } = await s.from('movimientos_caja').insert({
        proyecto_id: proyecto.id, tipo: mov.tipo, fecha: mov.fecha, valor: Number(mov.valor),
        concepto: mov.concepto.trim(), beneficiario: mov.tipo === 'RETIRO_UTILIDAD' ? (mov.beneficiario.trim() || null) : null,
        registrado_por: usuario.id,
      });
      if (e) throw e;
      setMov({ tipo: mov.tipo, fecha: hoy(), valor: '', concepto: '', beneficiario: '' });
      setPanel(null);
    });
  }

  function eliminarMovimiento(m) {
    if (!window.confirm(`¿Eliminar el movimiento "${m.concepto}" por ${formatoPesos(m.valor)}?`)) return;
    ejecutar(async (s) => { const { error: e } = await s.from('movimientos_caja').delete().eq('id', m.id); if (e) throw e; });
  }

  function guardarCostoPorEjecutar(valor) {
    if (valor !== null && !(Number(valor) >= 0)) { setError('Escribe un valor válido para el costo por ejecutar.'); return; }
    ejecutar(async (s) => {
      const { error: e } = await s.rpc('guardar_costo_por_ejecutar', { p_proyecto: proyecto.id, p_valor: valor === null ? null : Number(valor) });
      if (e) throw e;
      setEditCosto(null);
    });
  }

  function guardarConciliacion() {
    if (conc.saldo_banco === '') { setError('Escribe el saldo real de la cuenta.'); return; }
    ejecutar(async (s) => {
      const { error: e } = await s.from('conciliaciones_caja').insert({
        proyecto_id: proyecto.id, fecha: conc.fecha, saldo_banco: Number(conc.saldo_banco), nota: conc.nota.trim() || null, registrado_por: usuario.id,
      });
      if (e) throw e;
      setConc({ fecha: hoy(), saldo_banco: '', nota: '' });
    });
  }

  function guardarHito() {
    if (!hito.concepto.trim() || !(Number(hito.valor) > 0)) { setError('Escribe el concepto y el valor del hito.'); return; }
    ejecutar(async (s) => {
      const orden = (datos?.plan_pagos?.length || 0) + 1;
      const { error: e } = await s.from('plan_pagos_cliente').insert({
        proyecto_id: proyecto.id, orden, concepto: hito.concepto.trim(), valor: Number(hito.valor), fecha_estimada: hito.fecha_estimada || null,
      });
      if (e) throw e;
      setHito({ concepto: '', valor: '', fecha_estimada: '' });
    });
  }

  function eliminarHito(h) {
    if (!window.confirm(`¿Eliminar el hito "${h.concepto}"?`)) return;
    ejecutar(async (s) => { const { error: e } = await s.from('plan_pagos_cliente').delete().eq('id', h.id); if (e) throw e; });
  }

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;

  if (!esAdmin || !todoCosto) {
    return (
      <div>
        <NavBar usuario={usuario} proyecto={proyecto} />
        <main className="p-8 max-w-3xl mx-auto text-center text-neutral-500">
          {!esAdmin ? 'Esta sección es solo para administradores.' : 'La caja aplica a proyectos con modelo de contratación Todo costo.'}
        </main>
      </div>
    );
  }

  const d = datos;
  const c = d?.conciliacion;
  const comp = d?.compromisos || {};
  const planPendiente = (d?.plan_pagos || []).reduce((a, h) => a + (Number(h.valor) - Number(h.recibido)), 0);
  const totalPlan = (d?.plan_pagos || []).reduce((a, h) => a + Number(h.valor), 0);

  // OC que componen el renglón "Órdenes de Compra" (mismas que suma caja_proyecto).
  const ocsLibro = (libro || []).filter((r) => Number(r.orden_tipo) === 3);
  const gruposOC = GRUPOS_OC.map(([k, t]) => {
    const filas = ocsLibro.filter((r) => r.origen === k);
    return { k, t, filas, total: filas.reduce((a, r) => a + Number(r.egreso || 0), 0) };
  }).filter((g) => g.filas.length > 0);

  // ---------- Libro de movimientos, igual a la hoja CAJA-DIRECTA de la V1 ----------
  // FECHA · INGRESO · EGRESO · CONCEPTO · CAPÍTULO · SALDO (saldo acumulado en orden cronológico).
  const usados = new Set();
  let saldoAcum = 0;
  const filasLibro = (libro || []).map((r, i) => {
    saldoAcum += Number(r.ingreso || 0) - Number(r.egreso || 0);
    let mov = null;
    if (Number(r.orden_tipo) === 1 && d) {
      // Movimiento registrado (ingreso/retiro/ajuste): se ubica para poder eliminarlo.
      mov = (d.movimientos || []).find((m) => !usados.has(m.id) && m.tipo === r.tipo && String(m.fecha) === String(r.fecha)
        && Math.abs(Math.abs(Number(m.valor)) - (Number(r.ingreso) + Number(r.egreso))) < 0.01) || null;
      if (mov) usados.add(mov.id);
    }
    const clase = r.tipo === 'RETIRO_UTILIDAD' ? 'RETIROS' : Number(r.ingreso) > 0 ? 'INGRESOS' : 'EGRESOS';
    return { ...r, i, saldo: saldoAcum, mov, clase };
  });
  const q = busqueda.trim().toLowerCase();
  const filtradas = filasLibro
    .filter((f) => filtroLibro === 'TODOS' || f.clase === filtroLibro)
    .filter((f) => !q || `${f.concepto} ${f.capitulo} ${f.origen}`.toLowerCase().includes(q));
  const ordenadas = recientesPrimero ? [...filtradas].reverse() : filtradas;
  const filIng = filtradas.reduce((a, f) => a + Number(f.ingreso || 0), 0);
  const filEgr = filtradas.reduce((a, f) => a + Number(f.egreso || 0), 0);

  // Barra "¿A dónde fue el dinero del cliente?"
  const ingresos = Number(d?.ingresos || 0);
  const segmentos = d ? [
    { t: 'Histórico V1', v: Number(d.egresos.historico || 0), cls: 'bg-[#9b9187]' },
    { t: 'Órdenes de Compra', v: Number(d.egresos.ordenes_compra || 0), cls: 'bg-carbon' },
    { t: 'Retiros de utilidad', v: Number(d.retiros_utilidad || 0), cls: 'bg-dorado' },
    { t: 'Pagos de IVA', v: Number(d.egresos.pagos_iva || 0), cls: 'bg-[#6b7c93]' },
    { t: 'Saldo en libros', v: Math.max(Number(d.saldo_libros || 0), 0), cls: 'bg-green-600' },
  ].filter((x) => x.v > 0) : [];
  const pct = (v) => (ingresos > 0 ? (v / ingresos) * 100 : 0);
  const saldoPositivo = Number(d?.saldo_libros || 0) >= 0;
  const cierre = Number(d?.caja_proyectada_cierre || 0);
  // 060: IVA que no es de HABITATUM (ya cobrado sin pagar + el que viene en lo que falta por cobrar).
  const conIva = Number(d?.compromisos?.tasa_iva_en_cobros || 0) > 0 || Number(d?.egresos?.pagos_iva || 0) > 0;
  const ivaComprometido = Number(d?.compromisos?.iva_por_pagar || 0) + Number(d?.compromisos?.iva_por_cobrar || 0);
  const retiroHoy = c ? d?.retiro_maximo_banco : d?.retiro_maximo_libros;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-5xl mx-auto space-y-5">
        <div className="relative z-40 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Caja del proyecto</h1>
            <p className="text-sm text-neutral-500">
              {proyecto.nombre} · Cuenta {d?.finanzas?.cuenta_receptora === 'PERSONAL' ? 'personal' : 'HABITATUM'} · Solo administradores
            </p>
          </div>
          <div className="flex gap-2">
            <Desplegable oscuro etiqueta="Registrar movimiento"
              opciones={OPCIONES_MOV.filter(([k]) => k !== 'PAGO_IVA' || conIva).map(([k, t]) => [k, t, () => { setMov({ ...mov, tipo: k }); setPanel('MOV'); }])} />
            <Desplegable etiqueta="Más opciones" opciones={[
              ['CONC', 'Conciliar con banco', () => setPanel('CONC')],
              ['DIR', 'Caja directa (Excel)', () => router.push('/caja/directa')],
            ]} />
          </div>
        </div>

        {/* Barra flotante: queda visible arriba mientras se baja por la pantalla. */}
        {d && (
          <div className="sticky top-0 z-30 -mx-4 sm:mx-0 px-4 sm:px-0 pt-2 pb-2 bg-hueso/90 backdrop-blur">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gris-calido/60 rounded-lg overflow-hidden border border-gris-calido shadow-lg">
            <div className="bg-green-50 p-2 sm:p-3 border-l-4 border-green-600">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-green-800">Pagos cliente</p>
              <p className="text-base sm:text-lg font-semibold text-green-700 tabular-nums">{formatoPesos(Math.round(ingresos))}</p>
            </div>
            <div className="bg-white p-2 sm:p-3 border-l-4 border-carbon">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-neutral-500">Egresos de obra</p>
              <p className="text-base sm:text-lg font-semibold text-carbon tabular-nums">− {formatoPesos(Math.round(d.egresos.total))}</p>
            </div>
            <div className="bg-[#f6efe6] p-2 sm:p-3 border-l-4 border-dorado">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-[#7a5a30]">Retiros de utilidad</p>
              <p className="text-base sm:text-lg font-semibold text-[#8a6534] tabular-nums">− {formatoPesos(Math.round(d.retiros_utilidad))}</p>
            </div>
            <div className="bg-carbon p-2 sm:p-3 border-l-4 border-dorado">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-gris-calido">Saldo en libros</p>
              <p className={`text-base sm:text-lg font-semibold tabular-nums ${saldoPositivo ? 'text-green-400' : 'text-red-400'}`}>{formatoPesos(Math.round(d.saldo_libros))}</p>
            </div>
          </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

        {panel === 'MOV' && (
          <section className={`bg-white rounded-lg border-2 p-4 space-y-2 ${mov.tipo === 'INGRESO_CLIENTE' ? 'border-green-600' : mov.tipo === 'RETIRO_UTILIDAD' ? 'border-dorado' : mov.tipo === 'PAGO_IVA' ? 'border-[#6b7c93]' : 'border-carbon'}`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Registrar · {OPCIONES_MOV.find(([k]) => k === mov.tipo)?.[1]}</h2>
              <button onClick={() => setPanel(null)} className="text-neutral-400 hover:text-carbon px-2">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={mov.fecha} onChange={(e) => setMov({ ...mov, fecha: e.target.value })} className={CAMPO} />
              <input type="number" inputMode="decimal" placeholder={mov.tipo === 'AJUSTE' ? 'Valor (+ o −)' : 'Valor'} value={mov.valor} onChange={(e) => setMov({ ...mov, valor: e.target.value })} className={CAMPO} />
            </div>
            <input placeholder="Concepto" value={mov.concepto} onChange={(e) => setMov({ ...mov, concepto: e.target.value })} className={CAMPO} />
            {mov.tipo === 'RETIRO_UTILIDAD' && (
              <input placeholder="Socio que recibe (ej. Andrés Hincapié)" value={mov.beneficiario} onChange={(e) => setMov({ ...mov, beneficiario: e.target.value })} className={CAMPO} />
            )}
            <button disabled={guardando} onClick={guardarMovimiento} className="bg-carbon text-hueso px-4 py-2 rounded text-sm w-full">{guardando ? 'Guardando...' : 'Guardar movimiento'}</button>
            <p className="text-[11px] text-neutral-500">Los egresos de obra no se registran aquí: salen automáticamente de las Órdenes de Compra.</p>
          </section>
        )}

        {panel === 'CONC' && d && (
          <section className="bg-white rounded-lg border-2 border-carbon p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Conciliar con el banco</h2>
              <button onClick={() => setPanel(null)} className="text-neutral-400 hover:text-carbon px-2">✕</button>
            </div>
            {c && (
              <p className="text-sm">
                Último saldo real: <strong>{formatoPesos(c.saldo_banco)}</strong> al {fecha(c.fecha)} · diferencia con libros{' '}
                <span className={Math.abs(Number(c.diferencia)) > 1 ? 'text-red-700 font-semibold' : 'text-green-700'}>{Number(c.diferencia) < 0 ? '−' : '+'}{formatoPesos(Math.abs(c.diferencia))}</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={conc.fecha} onChange={(e) => setConc({ ...conc, fecha: e.target.value })} className={CAMPO} />
              <input type="number" inputMode="decimal" placeholder="Saldo real de la cuenta" value={conc.saldo_banco} onChange={(e) => setConc({ ...conc, saldo_banco: e.target.value })} className={CAMPO} />
            </div>
            <input placeholder="Nota (opcional)" value={conc.nota} onChange={(e) => setConc({ ...conc, nota: e.target.value })} className={CAMPO} />
            <button disabled={guardando} onClick={guardarConciliacion} className="border border-dorado text-dorado px-4 py-2 rounded text-sm w-full hover:bg-hueso">Registrar saldo</button>
            {d.conciliaciones.length > 0 && (
              <div className="text-xs text-neutral-600 pt-1 space-y-1">
                {d.conciliaciones.slice(0, 4).map((x) => (
                  <div key={x.id} className="flex justify-between border-t pt-1"><span>{fecha(x.fecha)}{x.nota ? ` · ${x.nota}` : ''}</span><span>{formatoPesos(x.saldo_banco)}</span></div>
                ))}
              </div>
            )}
          </section>
        )}

        {!d ? <p className="text-sm text-neutral-500">Cargando caja...</p> : (
          <>
            {/* ---------- FLUJO DE CAJA ---------- */}
            <section className="bg-white rounded-lg border overflow-hidden">
              <div className="bg-carbon text-hueso px-4 py-2.5 flex items-center justify-between">
                <h2 className="font-semibold tracking-wide">Flujo de caja</h2>
                <span className="text-[11px] text-gris-calido">al {new Date().toLocaleDateString('es-CO')}</span>
              </div>
              {ingresos > 0 && (
                <div className="px-4 pt-4">
                  <p className="text-xs text-neutral-500 mb-1.5">¿A dónde han ido los pagos del cliente?</p>
                  <div className="flex h-3 rounded-full overflow-hidden bg-hueso">
                    {segmentos.map((x) => <div key={x.t} className={x.cls} style={{ width: `${pct(x.v)}%` }} title={`${x.t}: ${formatoPesos(Math.round(x.v))}`} />)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-neutral-600">
                    {segmentos.map((x) => (
                      <span key={x.t} className="flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-sm ${x.cls}`} />{x.t} {Math.round(pct(x.v))}%</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4">
                <Fila etiqueta="Pagos cliente" valor={d.ingresos} color="text-green-700" />
                <Fila etiqueta="Egresos de obra" valor={d.egresos.total} signo="-"
                  nota="Solo lo pagado desde la cuenta de la obra; lo que pagó el cliente directo no suma aquí." />
                {Number(d.egresos.historico) > 0 && <Fila sub etiqueta="Histórico (formato anterior)" valor={d.egresos.historico} />}
                <Fila sub etiqueta="Órdenes de Compra" valor={d.egresos.ordenes_compra}
                  onClick={gruposOC.length > 0 ? () => setVerOC(!verOC) : undefined} abierto={verOC} />
                {verOC && (
                  <div className="ml-4 mb-2 border-l-2 border-dorado pl-3 text-xs">
                    {gruposOC.map((g) => (
                      <div key={g.k} className="py-1">
                        <button type="button" onClick={() => setGrupoAbierto(grupoAbierto === g.k ? '' : g.k)}
                          className="w-full flex justify-between gap-3 text-neutral-700 hover:text-carbon">
                          <span>{grupoAbierto === g.k ? '▾' : '▸'} {g.t} ({g.filas.length})</span>
                          <span className="tabular-nums">{formatoPesos(Math.round(g.total))}</span>
                        </button>
                        {grupoAbierto === g.k && (
                          <div className="mt-1 space-y-1">
                            {[...g.filas].reverse().map((r, i) => (
                              <div key={i} className="flex justify-between gap-3 text-neutral-500 pl-3">
                                <span className="min-w-0 break-words">{fecha(r.fecha)} · {r.concepto}</span>
                                <span className="tabular-nums whitespace-nowrap">{formatoPesos(Math.round(Number(r.egreso)))}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Fila etiqueta="Retiros de utilidad" valor={d.retiros_utilidad} signo="-" color="text-[#8a6534]" />
                {Number(d.egresos.pagos_iva) > 0 && <Fila etiqueta="Pagos de IVA a la DIAN" valor={d.egresos.pagos_iva} signo="-" />}
                {Number(d.ajustes) !== 0 && <Fila etiqueta="Ajustes" valor={d.ajustes} signo={Number(d.ajustes) < 0 ? '-' : '+'} />}
                <Fila fuerte etiqueta="Saldo en libros" valor={d.saldo_libros} color={saldoPositivo ? 'text-green-700' : 'text-red-700'}
                  nota="Lo que debería haber hoy en la cuenta según lo registrado. Si el banco muestra menos, falta registrar algún movimiento (por ejemplo, un retiro de utilidad)." />
              </div>
            </section>

            {c && Number(d.deficit_banco) < 0 && (
              <div className="bg-red-50 border border-red-200 text-red-900 rounded p-3 text-sm">
                Con el saldo real de la cuenta, la obra está <strong>desfinanciada en {formatoPesos(Math.abs(d.deficit_banco))}</strong>:
                el dinero en banco más lo que falta por cobrar no alcanza para el costo pendiente y los retenidos por devolver.
                La diferencia de {formatoPesos(Math.abs(c.diferencia))} entre libros y banco debe explicarse.
              </div>
            )}

            {/* ---------- PROYECCIÓN AL CIERRE ---------- */}
            <section className="bg-white rounded-lg border overflow-hidden">
              <div className="bg-hueso border-b border-gris-calido px-4 py-2.5"><h2 className="font-semibold">Proyección al cierre</h2></div>
              <div className="p-4">
                <Fila etiqueta="Saldo en libros" valor={d.saldo_libros} />
                <Fila etiqueta="Por cobrar al cliente" valor={d.por_cobrar} signo="+" color="text-green-700" nota={`De ${formatoPesos(d.contrato.total)} pactados (contrato + adicionales)`} />
                <div className="py-1.5">
                  <div className="flex justify-between gap-3 text-sm">
                    <span>Costo que falta por ejecutar</span>
                    {editCosto === null ? (
                      <span className="flex items-center gap-2">
                        <span className="whitespace-nowrap tabular-nums">− {formatoPesos(Math.round(Number(comp.costo_por_ejecutar || 0)))}</span>
                        <button type="button" onClick={() => setEditCosto(String(Math.round(Number(comp.costo_por_ejecutar || 0))))}
                          className="text-xs border border-dorado text-[#8a6534] rounded px-2 py-0.5 hover:bg-hueso">✎ Editar</button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <input type="number" inputMode="decimal" autoFocus value={editCosto} onChange={(e) => setEditCosto(e.target.value)}
                          className="border rounded px-2 py-1 text-sm w-36 text-right" />
                        <button type="button" disabled={guardando} onClick={() => guardarCostoPorEjecutar(editCosto)} className="bg-carbon text-hueso text-xs rounded px-2 py-1">Guardar</button>
                        <button type="button" onClick={() => setEditCosto(null)} className="text-xs text-neutral-500 px-1">✕</button>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    {comp.costo_por_ejecutar_manual
                      ? <>Valor manual (proyección interna){comp.costo_por_ejecutar_fecha ? ` · ${fecha(comp.costo_por_ejecutar_fecha)}` : ''} · cálculo automático {formatoPesos(Math.round(Number(comp.costo_por_ejecutar_calculado || 0)))}{' · '}
                          <button type="button" disabled={guardando} onClick={() => guardarCostoPorEjecutar(null)} className="underline hover:text-carbon">volver al automático</button></>
                      : 'Automático: costo de ejecución (presupuestado sin la utilidad real incluida) − ejecutado por capítulo. Usa ✎ Editar para poner tu proyección interna.'}
                  </p>
                </div>
                <Fila etiqueta="Retenidos por devolver a contratistas" valor={comp.retenidos_por_devolver} signo="-" />
                {conIva && (
                  <Fila etiqueta="IVA por pagar (DIAN)" valor={ivaComprometido} signo="-"
                    nota={`IVA ya cobrado sin pagar ${formatoPesos(Math.round(Number(comp.iva_por_pagar || 0)))} (cobrado ${formatoPesos(Math.round(Number(comp.iva_cobrado || 0)))} − pagado ${formatoPesos(Math.round(Number(comp.iva_pagado || 0)))}) + IVA incluido en lo que falta por cobrar ${formatoPesos(Math.round(Number(comp.iva_por_cobrar || 0)))}. No es utilidad.`} />
                )}
                <div className={`mt-2 rounded-md px-3 py-2.5 flex justify-between gap-3 font-semibold ${cierre >= 0 ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  <span>Caja al cierre (utilidad por retirar)</span>
                  <span className="tabular-nums whitespace-nowrap">{cierre < 0 ? '− ' : ''}{formatoPesos(Math.round(Math.abs(cierre)))}</span>
                </div>
                <div className="mt-3 rounded-md bg-[#f6efe6] border border-dorado/40 px-3 py-2.5">
                  <div className="flex justify-between gap-3 text-sm font-semibold text-[#6b4a22]">
                    <span>Utilidad que se puede retirar hoy</span>
                    <span className="tabular-nums whitespace-nowrap">{formatoPesos(Math.round(Number(retiroHoy || 0)))}</span>
                  </div>
                  <p className="text-[11px] text-[#7a5a30] mt-1">
                    Lo que se puede sacar hoy de la cuenta sin dejar la obra corta: {c ? 'saldo real del banco' : 'saldo en libros'} menos los retenidos por devolver,
                    {conIva ? ' menos el IVA ya cobrado que falta pagar a la DIAN,' : ''} y menos la parte del costo que falta que no alcanza a cubrir lo que el cliente aún debe pagar{conIva ? ' (sin contar su IVA)' : ''}.
                  </p>
                </div>
              </div>
            </section>

            {/* ---------- LIBRO DE MOVIMIENTOS (formato V1) ---------- */}
            <section className="bg-white rounded-lg border overflow-hidden">
              <button type="button" onClick={() => setLibroAbierto(!libroAbierto)} className="w-full flex items-center justify-between px-4 py-3 bg-carbon text-hueso">
                <span className="font-semibold">{libroAbierto ? '▾' : '▸'} Libro de movimientos</span>
                <span className="text-xs text-gris-calido">{filasLibro.length} renglones · formato CAJA-DIRECTA</span>
              </button>
              {libroAbierto && (
                <div>
                  <div className="flex flex-wrap gap-2 items-center p-3 border-b bg-hueso/60">
                    {[['TODOS', 'Todos', 'bg-carbon border-carbon'], ['INGRESOS', 'Pagos cliente', 'bg-green-700 border-green-700'], ['EGRESOS', 'Egresos', 'bg-red-700 border-red-700'], ['RETIROS', 'Retiros', 'bg-dorado border-dorado']].map(([k, t, on]) => (
                      <button key={k} type="button" onClick={() => setFiltroLibro(k)}
                        className={`px-3 py-1 rounded-full text-xs border ${filtroLibro === k ? `${on} text-white` : 'bg-white border-neutral-300 text-neutral-600'}`}>{t}</button>
                    ))}
                    <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar concepto, proveedor, OC o capítulo…"
                      className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[180px] bg-white" />
                    <label className="flex items-center gap-1 text-xs text-neutral-600">
                      <input type="checkbox" checked={recientesPrimero} onChange={(e) => setRecientesPrimero(e.target.checked)} /> Más recientes primero
                    </label>
                    <span className="text-xs text-neutral-600 w-full">
                      {filtradas.length} renglones · ingresos <span className="text-green-700 font-medium">{formatoPesos(Math.round(filIng))}</span> · egresos <span className="text-red-700 font-medium">{formatoPesos(Math.round(filEgr))}</span>
                    </span>
                  </div>
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-gris-calido text-carbon text-left">
                          <th className="px-2 py-2 font-semibold">FECHA</th>
                          <th className="px-2 py-2 font-semibold text-right">INGRESO</th>
                          <th className="px-2 py-2 font-semibold text-right">EGRESO</th>
                          <th className="px-2 py-2 font-semibold">CONCEPTO</th>
                          <th className="px-2 py-2 font-semibold">CAPÍTULO</th>
                          <th className="px-2 py-2 font-semibold text-right">SALDO</th>
                          <th className="px-1 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {ordenadas.map((f, k) => {
                          const mes = String(f.fecha).slice(0, 7);
                          const mesPrevio = k > 0 ? String(ordenadas[k - 1].fecha).slice(0, 7) : null;
                          return [
                            mes !== mesPrevio && (
                              <tr key={`m-${mes}-${k}`} className="bg-hueso">
                                <td colSpan={7} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8a6534] border-y border-gris-calido">{nombreMes(mes)}</td>
                              </tr>
                            ),
                            <tr key={f.i} className={`border-b ${f.clase === 'RETIROS' ? 'bg-[#ead9c2] border-[#b88a52]/40 text-[#5a3d1a] font-medium' : `border-neutral-100 ${k % 2 ? 'bg-neutral-50/70' : 'bg-white'} hover:bg-[#f6efe6]`}`}>
                              <td className="px-2 py-1.5 whitespace-nowrap text-neutral-600">{fecha(f.fecha)}</td>
                              <td className="px-2 py-1.5 text-right whitespace-nowrap font-semibold text-green-700 tabular-nums">{Number(f.ingreso) ? formatoPesos(Math.round(Number(f.ingreso))) : ''}</td>
                              <td className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${f.clase === 'RETIROS' ? 'text-[#8a6534] font-semibold' : 'text-red-700'}`}>{Number(f.egreso) ? formatoPesos(Math.round(Number(f.egreso))) : ''}</td>
                              <td className="px-2 py-1.5 min-w-[240px]">
                                {f.concepto}
                                {f.origen && f.origen !== 'V1' && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-hueso text-neutral-600 border border-gris-calido">{f.origen}</span>}
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-neutral-600">{f.capitulo}</td>
                              <td className={`px-2 py-1.5 text-right whitespace-nowrap font-semibold tabular-nums ${f.saldo < 0 ? 'text-red-700' : 'text-carbon'}`}>{formatoPesos(Math.round(f.saldo))}</td>
                              <td className="px-1 py-1.5 text-right">
                                {f.mov && <button onClick={() => eliminarMovimiento(f.mov)} title="Eliminar movimiento" className="text-neutral-300 hover:text-red-600">✕</button>}
                              </td>
                            </tr>,
                          ];
                        })}
                        {ordenadas.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-neutral-500">Sin movimientos con ese filtro.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-neutral-500 p-3 border-t">El saldo de cada renglón es el acumulado de todo el libro en orden de fecha (no cambia con los filtros). No incluye lo que el cliente paga directamente.</p>
                </div>
              )}
            </section>

            <section className="bg-white rounded-lg border overflow-hidden">
              <div className="bg-hueso border-b border-gris-calido px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">Plan de pagos del cliente</h2>
                <span className="text-xs text-neutral-500">Total {formatoPesos(totalPlan)} · pendiente {formatoPesos(planPendiente)}</span>
              </div>
              <div className="p-4">
                {Math.abs(totalPlan - Number(d.contrato.total)) > 1 && d.plan_pagos.length > 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
                    El plan suma {formatoPesos(totalPlan)} y el contrato más adicionales suma {formatoPesos(d.contrato.total)}.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">Hito</th><th>Fecha estimada</th><th className="text-right">Valor</th><th className="text-right">Recibido</th><th className="pl-3">Estado</th><th /></tr></thead>
                    <tbody>
                      {d.plan_pagos.map((h) => (
                        <tr key={h.id} className="border-t">
                          <td className="py-2">{h.concepto}</td>
                          <td>{fecha(h.fecha_estimada)}</td>
                          <td className="text-right">{formatoPesos(h.valor)}</td>
                          <td className="text-right">{formatoPesos(h.recibido)}</td>
                          <td className="pl-3"><span className={`text-[11px] px-2 py-0.5 rounded ${ESTADOS[h.estado]}`}>{h.estado}</span></td>
                          <td className="text-right"><button onClick={() => eliminarHito(h)} className="text-xs text-neutral-400 hover:text-red-600">Eliminar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid sm:grid-cols-4 gap-2 mt-3">
                  <input placeholder="Hito (ej. Pago final contra entrega)" value={hito.concepto} onChange={(e) => setHito({ ...hito, concepto: e.target.value })} className={`${CAMPO} sm:col-span-2`} />
                  <input type="number" placeholder="Valor" value={hito.valor} onChange={(e) => setHito({ ...hito, valor: e.target.value })} className={CAMPO} />
                  <div className="flex gap-2">
                    <input type="date" value={hito.fecha_estimada} onChange={(e) => setHito({ ...hito, fecha_estimada: e.target.value })} className={CAMPO} />
                    <button disabled={guardando} onClick={guardarHito} className="bg-carbon text-hueso px-3 rounded text-sm">+</button>
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-lg border overflow-hidden">
              <div className="bg-hueso border-b border-gris-calido px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">Caja menor por legalizar</h2>
                <span className="text-xs text-neutral-500">
                  {formatoPesos(cajaMenor.reduce((a, g) => a + Number(g.valor), 0))} de {formatoPesos(proyecto.tope_caja_menor)} · se legaliza sola al llegar al tope
                </span>
              </div>
              <div className="p-4">
                {cajaMenor.length === 0 ? (
                  <p className="text-sm text-neutral-500">No hay gastos de caja menor pendientes. Se registran desde el grupo de finanzas de Telegram con la nota CAJA MENOR.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">Fecha</th><th>Concepto</th><th>Capítulo</th><th className="text-right">Valor</th></tr></thead>
                        <tbody>
                          {cajaMenor.map((g) => (
                            <tr key={g.id} className="border-t">
                              <td className="py-2 whitespace-nowrap">{fecha(g.fecha)}</td>
                              <td>{g.concepto}{g.remitente ? ` · ${g.remitente}` : ''}</td>
                              <td className="text-xs">{g.presupuesto_capitulos ? `${g.presupuesto_capitulos.codigo} · ${g.presupuesto_capitulos.nombre}` : '—'}</td>
                              <td className="text-right whitespace-nowrap">{formatoPesos(g.valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button disabled={guardando} onClick={legalizarCajaMenor} className="mt-3 border border-dorado text-dorado px-4 py-2 rounded text-sm hover:bg-hueso">
                      Legalizar ahora en una OC
                    </button>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
