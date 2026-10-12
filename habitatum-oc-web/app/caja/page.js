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
const TIPOS = { INGRESO_CLIENTE: 'Ingreso del cliente', RETIRO_UTILIDAD: 'Retiro de utilidad', AJUSTE: 'Ajuste' };
// Opciones del botón "Registrar movimiento" ("Otro" = ajuste, valor + o −).
const OPCIONES_MOV = [['INGRESO_CLIENTE', 'Ingreso del cliente'], ['RETIRO_UTILIDAD', 'Retiro de utilidad'], ['AJUSTE', 'Otro (ajuste)']];
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

function Fila({ etiqueta, valor, signo, fuerte, sub, nota, onClick, abierto }) {
  return (
    <div className={`py-1.5 ${fuerte ? 'font-semibold border-t border-dorado mt-1 pt-2' : ''}`}>
      <div className={`flex justify-between gap-3 ${sub ? 'pl-4 text-xs text-neutral-500' : 'text-sm'}`}>
        {onClick ? (
          <button type="button" onClick={onClick} className="text-left hover:text-carbon underline decoration-dotted underline-offset-2">
            {abierto ? '▾' : '▸'} {etiqueta}
          </button>
        ) : <span>{etiqueta}</span>}
        <span className="whitespace-nowrap tabular-nums">{signo === '-' && Number(valor) ? '− ' : signo === '+' ? '+ ' : ''}{formatoPesos(Math.abs(Number(valor) || 0))}</span>
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
  const [mesAbierto, setMesAbierto] = useState({});

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

  // Libro de movimientos: ingresos/retiros/ajustes (con su id para poder eliminarlos)
  // + egresos del histórico V1, de las OC y de la caja menor por legalizar.
  const filasLibro = [
    ...(d?.movimientos || []).map((m) => ({
      key: `m-${m.id}`, fecha: m.fecha, mov: m,
      clase: m.tipo === 'INGRESO_CLIENTE' ? 'INGRESOS' : m.tipo === 'RETIRO_UTILIDAD' ? 'RETIROS' : (Number(m.valor) < 0 ? 'EGRESOS' : 'INGRESOS'),
      valor: m.tipo === 'RETIRO_UTILIDAD' ? -Math.abs(Number(m.valor)) : Number(m.valor),
      concepto: `${m.concepto}${m.beneficiario ? ` · ${m.beneficiario}` : ''}`,
      etiqueta: TIPOS[m.tipo], v1: String(m.concepto || '').endsWith('(V1)'),
    })),
    ...(libro || []).filter((r) => Number(r.orden_tipo) !== 1).map((r, i) => ({
      key: `l-${i}`, fecha: r.fecha, clase: 'EGRESOS', valor: -Number(r.egreso || 0),
      concepto: r.concepto, etiqueta: r.origen === 'V1' ? `Cap. ${r.capitulo}` : `${r.origen} · Cap. ${r.capitulo}`, v1: r.origen === 'V1',
    })),
  ];
  const q = busqueda.trim().toLowerCase();
  const filtradas = filasLibro
    .filter((f) => filtroLibro === 'TODOS' || f.clase === filtroLibro)
    .filter((f) => !q || `${f.concepto} ${f.etiqueta}`.toLowerCase().includes(q))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  // El histórico V1 se agrupa por mes; lo demás va renglón a renglón.
  const bloques = [];
  const porMes = {};
  filtradas.forEach((f) => {
    if (f.v1) {
      const ym = String(f.fecha).slice(0, 7);
      if (!porMes[ym]) { porMes[ym] = { tipo: 'MES', ym, filas: [] }; bloques.push(porMes[ym]); }
      porMes[ym].filas.push(f);
    } else bloques.push({ tipo: 'FILA', f });
  });
  const totalFiltrado = filtradas.reduce((a, f) => a + f.valor, 0);

  function RenglonLibro({ f, sangria }) {
    return (
      <div className={`flex items-start justify-between gap-3 py-2 border-t text-sm ${sangria ? 'pl-4 bg-neutral-50/60' : ''}`}>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">{fecha(f.fecha)} · {f.etiqueta}</p>
          <p className="break-words">{f.concepto}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`whitespace-nowrap tabular-nums ${f.valor >= 0 ? 'text-green-700' : f.clase === 'RETIROS' ? 'text-red-700' : 'text-neutral-800'}`}>
            {f.valor < 0 ? '− ' : ''}{formatoPesos(Math.abs(f.valor))}
          </p>
          {f.mov && <button onClick={() => eliminarMovimiento(f.mov)} className="text-[11px] text-neutral-400 hover:text-red-600">Eliminar</button>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Caja del proyecto</h1>
            <p className="text-sm text-neutral-500">
              {proyecto.nombre} · Cuenta {d?.finanzas?.cuenta_receptora === 'PERSONAL' ? 'personal' : 'HABITATUM'} · Solo administradores
            </p>
          </div>
          <div className="flex gap-2">
            <Desplegable oscuro etiqueta="Registrar movimiento"
              opciones={OPCIONES_MOV.map(([k, t]) => [k, t, () => { setMov({ ...mov, tipo: k }); setPanel('MOV'); }])} />
            <Desplegable etiqueta="Más opciones" opciones={[
              ['CONC', 'Conciliar con banco', () => setPanel('CONC')],
              ['DIR', 'Caja directa (saldo por renglón y Excel)', () => router.push('/caja/directa')],
            ]} />
          </div>
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

        {panel === 'MOV' && (
          <section className="bg-white rounded-lg border border-dorado p-4 space-y-2">
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
          <section className="bg-white rounded-lg border border-dorado p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Conciliar con el banco</h2>
              <button onClick={() => setPanel(null)} className="text-neutral-400 hover:text-carbon px-2">✕</button>
            </div>
            {c && (
              <p className="text-sm">
                Último saldo real: <strong>{formatoPesos(c.saldo_banco)}</strong> al {fecha(c.fecha)} · diferencia con libros{' '}
                <span className={Math.abs(Number(c.diferencia)) > 1 ? 'text-red-700' : ''}>{Number(c.diferencia) < 0 ? '−' : '+'}{formatoPesos(Math.abs(c.diferencia))}</span>
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
            <section className="bg-white rounded-lg border border-t-2 border-t-dorado p-4">
              <h2 className="font-semibold mb-2">Flujo de caja</h2>
              <Fila etiqueta="Ingresos del cliente" valor={d.ingresos} />
              <Fila etiqueta="Egresos de obra" valor={d.egresos.total} signo="-"
                nota="Solo lo pagado desde la cuenta de la obra; lo que pagó el cliente directo no suma aquí." />
              {Number(d.egresos.historico) > 0 && <Fila sub etiqueta="Histórico (formato anterior)" valor={d.egresos.historico} />}
              <Fila sub etiqueta="Órdenes de Compra" valor={d.egresos.ordenes_compra}
                onClick={gruposOC.length > 0 ? () => setVerOC(!verOC) : undefined} abierto={verOC} />
              {verOC && (
                <div className="ml-4 mb-2 border-l-2 border-gris-calido pl-3 text-xs">
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
              <Fila etiqueta="Retiros de utilidad" valor={d.retiros_utilidad} signo="-" />
              {Number(d.ajustes) !== 0 && <Fila etiqueta="Ajustes" valor={d.ajustes} signo={Number(d.ajustes) < 0 ? '-' : '+'} />}
              <Fila fuerte etiqueta="Saldo en libros" valor={d.saldo_libros}
                nota="Lo que debería haber hoy en la cuenta según lo registrado. Si el banco muestra menos, falta registrar algún movimiento (por ejemplo, un retiro de utilidad)." />
            </section>

            {c && Number(d.deficit_banco) < 0 && (
              <div className="bg-red-50 border border-red-200 text-red-900 rounded p-3 text-sm">
                Con el saldo real de la cuenta, la obra está <strong>desfinanciada en {formatoPesos(Math.abs(d.deficit_banco))}</strong>:
                el dinero en banco más lo que falta por cobrar no alcanza para el costo pendiente y los retenidos por devolver.
                Con el saldo en libros, el retiro máximo sería {formatoPesos(d.retiro_maximo_libros)}. La diferencia de {formatoPesos(Math.abs(c.diferencia))} entre libros y banco debe explicarse.
              </div>
            )}

            <section className="bg-white rounded-lg border">
              <button type="button" onClick={() => setLibroAbierto(!libroAbierto)} className="w-full flex items-center justify-between p-4">
                <span className="font-semibold">{libroAbierto ? '▾' : '▸'} Libro de movimientos</span>
                <span className="text-xs text-neutral-500">{filasLibro.length} renglones</span>
              </button>
              {libroAbierto && (
                <div className="px-4 pb-4">
                  <div className="flex flex-wrap gap-2 items-center mb-2">
                    {[['TODOS', 'Todos'], ['INGRESOS', 'Ingresos'], ['EGRESOS', 'Egresos'], ['RETIROS', 'Retiros']].map(([k, t]) => (
                      <button key={k} type="button" onClick={() => setFiltroLibro(k)}
                        className={`px-3 py-1 rounded-full text-xs border ${filtroLibro === k ? 'bg-carbon text-hueso border-carbon' : 'border-neutral-300 text-neutral-600'}`}>{t}</button>
                    ))}
                    <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar concepto, proveedor u OC…"
                      className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[180px]" />
                  </div>
                  <p className="text-xs text-neutral-500 mb-1">{filtradas.length} renglones · neto {totalFiltrado < 0 ? '−' : ''}{formatoPesos(Math.round(Math.abs(totalFiltrado)))}</p>
                  {bloques.map((b) => b.tipo === 'FILA' ? <RenglonLibro key={b.f.key} f={b.f} /> : (
                    <div key={`mes-${b.ym}`}>
                      <button type="button" onClick={() => setMesAbierto({ ...mesAbierto, [b.ym]: !mesAbierto[b.ym] })}
                        className="w-full flex justify-between gap-3 py-2 border-t text-sm text-left">
                        <span>{mesAbierto[b.ym] ? '▾' : '▸'} Histórico V1 · {nombreMes(b.ym)} <span className="text-xs text-neutral-500">({b.filas.length})</span></span>
                        <span className="tabular-nums whitespace-nowrap">{(() => { const t = b.filas.reduce((a, f) => a + f.valor, 0); return `${t < 0 ? '− ' : ''}${formatoPesos(Math.round(Math.abs(t)))}`; })()}</span>
                      </button>
                      {mesAbierto[b.ym] && b.filas.map((f) => <RenglonLibro key={f.key} f={f} sangria />)}
                    </div>
                  ))}
                  {filtradas.length === 0 && <p className="text-sm text-neutral-500 py-2">Sin movimientos con ese filtro.</p>}
                </div>
              )}
            </section>

            <section className="bg-white rounded-lg border p-4">
              <h2 className="font-semibold mb-2">Proyección al cierre</h2>
              <Fila etiqueta="Saldo en libros" valor={d.saldo_libros} />
              <Fila etiqueta="Por cobrar al cliente" valor={d.por_cobrar} signo="+" nota={`De ${formatoPesos(d.contrato.total)} pactados`} />
              <Fila etiqueta="Costo que falta por ejecutar" valor={comp.costo_por_ejecutar} signo="-" />
              <Fila etiqueta="Retenidos por devolver a contratistas" valor={comp.retenidos_por_devolver} signo="-" />
              <Fila fuerte etiqueta="Caja al cierre (utilidad por retirar)" valor={d.caja_proyectada_cierre} />
              <Fila etiqueta="Retiro máximo sugerido hoy" valor={c ? d.retiro_maximo_banco : d.retiro_maximo_libros}
                nota={c ? 'Sobre el último saldo real conciliado' : 'Sobre el saldo en libros'} />
              <p className="text-[11px] text-neutral-500 mt-2">
                Supone que se cobra todo lo pactado y cada capítulo consume su costo presupuestado (o lo ya ejecutado, si lo superó).
              </p>
            </section>

            <section className="bg-white rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h2 className="font-semibold">Plan de pagos del cliente</h2>
                <span className="text-xs text-neutral-500">Total {formatoPesos(totalPlan)} · pendiente {formatoPesos(planPendiente)}</span>
              </div>
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
            </section>

            <section className="bg-white rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h2 className="font-semibold">Caja menor por legalizar</h2>
                <span className="text-xs text-neutral-500">
                  {formatoPesos(cajaMenor.reduce((a, g) => a + Number(g.valor), 0))} de {formatoPesos(proyecto.tope_caja_menor)} · se legaliza sola al llegar al tope
                </span>
              </div>
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
            </section>
          </>
        )}
      </main>
    </div>
  );
}
