'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import { recalcular, fechaCC, tituloCorte, exportarCorteClienteExcel } from '@/lib/cortesCliente';
import NavBar from '@/components/NavBar';
import TablaControlCorteCliente from '@/components/TablaControlCorteCliente';

// ============================================================
// Cortes de cobro y liquidación al CLIENTE · proyectos TODO COSTO · solo admin (057).
// Se llega desde el botón "Cortes al cliente" de Presupuesto. Todo el cálculo oficial
// lo hace la base de datos (corte_cliente_detalle); aquí se recalcula en vivo al escribir.
// ============================================================

const hoy = () => new Date().toISOString().slice(0, 10);
const pesos = (v) => formatoPesos(Math.round(Number(v) || 0));
const pct1 = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-CO')}%`;

function Tarjeta({ titulo, valor, nota, tono = '' }) {
  return (
    <div className={`rounded-lg border p-4 border-t-2 border-t-dorado ${tono || 'bg-white'}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-70">{titulo}</p>
      <p className="text-lg font-semibold mt-1 tabular-nums">{valor}</p>
      {nota && <p className="text-xs mt-0.5 opacity-70">{nota}</p>}
    </div>
  );
}

export default function CortesCliente() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [lista, setLista] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [edic, setEdic] = useState({ caps: {}, items: {} });
  const [meta, setMeta] = useState({ fecha: hoy(), es_final: false, notas: '' });
  const [cerrados, setCerrados] = useState({});
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [fechaNuevo, setFechaNuevo] = useState(hoy());

  const esAdmin = usuario?.rol === 'admin';
  const todoCosto = proyecto?.modelo_contratacion === 'TODO_COSTO';

  async function cargarLista(seleccionar) {
    const { data, error: err } = await crearClienteSupabase().rpc('cortes_cliente_lista', { p_proyecto: proyecto.id });
    if (err) { setError(err.message); return; }
    setLista(data || []);
    const id = seleccionar !== undefined ? seleccionar : (data || []).slice(-1)[0]?.id;
    if (id) abrirCorte(id); else setDetalle(null);
  }
  async function abrirCorte(id) {
    setError(''); setAviso('');
    const { data, error: err } = await crearClienteSupabase().rpc('corte_cliente_detalle', { p_corte: id });
    if (err) { setError(err.message); return; }
    cargarDetalle(data);
  }
  function cargarDetalle(data) {
    setDetalle(data);
    setEdic({ caps: {}, items: {} });
    setMeta({ fecha: data.corte.fecha, es_final: !!data.corte.es_final, notas: data.corte.notas || '' });
  }
  useEffect(() => { if (esAdmin && todoCosto && proyecto) cargarLista(); }, [esAdmin, todoCosto, proyecto?.id]); // eslint-disable-line

  const calc = useMemo(() => recalcular(detalle, edic), [detalle, edic]);
  const abierto = detalle?.corte?.estado === 'BORRADOR';
  const hayCambios = !!detalle && (Object.keys(edic.caps).length > 0 || Object.keys(edic.items).length > 0
    || meta.fecha !== detalle.corte.fecha || meta.es_final !== !!detalle.corte.es_final || (meta.notas || '') !== (detalle.corte.notas || ''));

  async function ejecutar(fn, ok) {
    setError(''); setAviso(''); setTrabajando(true);
    try { await fn(crearClienteSupabase()); if (ok) setAviso(ok); } catch (e) { setError(e.message || String(e)); }
    setTrabajando(false);
  }

  function crearCorte() {
    ejecutar(async (s) => {
      const { data, error: err } = await s.rpc('crear_corte_cliente', { p_proyecto: proyecto.id, p_fecha: fechaNuevo });
      if (err) throw err;
      await cargarLista(data);
    }, 'Corte creado. Escribe las cantidades o los % y guarda.');
  }

  async function guardar() {
    if (!calc) return false;
    let okGuardar = false;
    await ejecutar(async (s) => {
      const p_capitulos = calc.capitulos.map((c) => ({ capitulo_id: c.id, modo: c.modo, porcentaje: Number(c.porcentaje) || 0 }));
      const p_items = calc.capitulos.flatMap((c) => c.items.filter((it) => edic.items[it.id] !== undefined || Number(it.este))
        .map((it) => ({ item_id: it.id, cantidad: Number(String(it.este ?? '').replace(',', '.')) || 0 })));
      const { data, error: err } = await s.rpc('guardar_corte_cliente', {
        p_corte: detalle.corte.id, p_fecha: meta.fecha, p_final: meta.es_final, p_notas: meta.notas, p_capitulos, p_items,
      });
      if (err) throw err;
      cargarDetalle(data);
      const { data: l } = await s.rpc('cortes_cliente_lista', { p_proyecto: proyecto.id });
      setLista(l || []);
      okGuardar = true;
    }, 'Corte guardado.');
    return okGuardar;
  }

  async function cerrar() {
    const texto = meta.es_final
      ? '¿Cerrar la LIQUIDACIÓN FINAL? Queda bloqueada y la obra no podrá tener más cortes al cliente.'
      : `¿Cerrar el corte No. ${detalle.corte.numero}? Queda bloqueado y el siguiente corte partirá de estos acumulados.`;
    if (!window.confirm(texto)) return;
    if (hayCambios && !(await guardar())) return;
    ejecutar(async (s) => {
      const { error: err } = await s.rpc('cerrar_corte_cliente', { p_corte: detalle.corte.id });
      if (err) throw err;
      await cargarLista(detalle.corte.id);
    }, 'Corte cerrado.');
  }

  function anular() {
    if (!window.confirm(`¿Anular el corte No. ${detalle.corte.numero}? Desaparece de la lista (queda registrado como anulado).`)) return;
    ejecutar(async (s) => {
      const { error: err } = await s.rpc('anular_corte_cliente', { p_corte: detalle.corte.id });
      if (err) throw err;
      await cargarLista();
    }, 'Corte anulado.');
  }

  async function descargarPDF() {
    if (hayCambios) { setError('Guarda los cambios antes de descargar el PDF.'); return; }
    const { data: { session } } = await crearClienteSupabase().auth.getSession();
    const nombre = `${tituloCorte(detalle.corte)} - ${proyecto.nombre}.pdf`;
    await compartirOAbrirArchivo(`/api/cortes-cliente/${detalle.corte.id}/pdf`, nombre, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
  }

  const setCap = (id, cambios) => setEdic((p) => ({ ...p, caps: { ...p.caps, [id]: { ...(p.caps[id] || {}), ...cambios } } }));
  const setItem = (id, v) => setEdic((p) => ({ ...p, items: { ...p.items, [id]: v } }));

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;
  if (!esAdmin || !todoCosto) {
    return (
      <div>
        <NavBar usuario={usuario} proyecto={proyecto} />
        <main className="p-8 max-w-3xl mx-auto text-center text-neutral-500">
          {!esAdmin ? 'Esta sección es solo para administradores.' : 'Los cortes al cliente aplican a proyectos Todo costo.'}
        </main>
      </div>
    );
  }

  const hayFinalCerrado = (lista || []).some((k) => k.es_final && k.estado === 'CERRADO');
  const hayAbierto = (lista || []).some((k) => k.estado === 'BORRADOR');
  const final = meta.es_final;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/presupuesto" className="text-xs text-neutral-500 hover:text-carbon">← Volver a Presupuesto</Link>
            <h1 className="text-2xl font-semibold">Cortes al cliente</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre} · cobro y liquidación del contrato todo costo</p>
          </div>
          {!hayAbierto && !hayFinalCerrado && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[11px] text-neutral-500 block">Fecha del corte</label>
                <input type="date" value={fechaNuevo} onChange={(e) => setFechaNuevo(e.target.value)} className="border rounded px-2 py-2 text-sm" />
              </div>
              <button type="button" disabled={trabajando} onClick={crearCorte} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
                + Nuevo corte No. {((lista || []).slice(-1)[0]?.numero || 0) + 1}
              </button>
            </div>
          )}
        </div>

        {error && <p role="alert" className="text-red-700 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}
        {aviso && <p className="text-green-800 text-sm bg-green-50 border border-green-200 rounded p-3">{aviso}</p>}

        {lista && lista.length === 0 && (
          <div className="bg-white rounded-lg border p-8 text-center text-neutral-500 text-sm">
            Esta obra todavía no tiene cortes al cliente. Elige la fecha y crea el corte No. 1.
          </div>
        )}

        {lista && lista.length > 0 && (
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gris-calido/30 text-left">
                <tr>
                  <th className="p-3">Corte</th><th className="p-3">Fecha</th><th className="p-3">Estado</th>
                  <th className="p-3 text-right">Este corte</th><th className="p-3 text-right">Acumulado</th>
                  <th className="p-3 text-right">Pagos cliente</th><th className="p-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((k) => {
                  const saldo = Number(k.acumulado) - Number(k.pagos);
                  const sel = detalle?.corte?.id === k.id;
                  return (
                    <tr key={k.id} onClick={() => abrirCorte(k.id)} className={`border-t cursor-pointer hover:bg-hueso/60 ${sel ? 'bg-hueso' : ''}`}>
                      <td className="p-3 font-medium">{k.es_final ? `Liquidación final (No. ${k.numero})` : `Corte No. ${k.numero}`}</td>
                      <td className="p-3">{fechaCC(k.fecha)}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${k.estado === 'CERRADO' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          {k.estado === 'CERRADO' ? 'Cerrado' : 'Abierto'}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums">{pesos(k.este_corte)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold">{pesos(k.acumulado)}</td>
                      <td className="p-3 text-right tabular-nums text-green-800">{pesos(k.pagos)}</td>
                      <td className={`p-3 text-right tabular-nums font-semibold ${saldo < 0 ? 'text-green-800' : ''}`}>
                        {saldo < 0 ? `A favor ${pesos(-saldo)}` : pesos(saldo)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {calc && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{final ? `Liquidación final (corte No. ${calc.corte.numero})` : `Corte No. ${calc.corte.numero}`}</h2>
                  <p className="text-xs text-neutral-500">
                    {calc.numero_anterior ? `Parte de los acumulados del corte No. ${calc.numero_anterior}.` : 'Primer corte de la obra.'}
                    {!abierto && ' Cerrado: solo lectura.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={descargarPDF} className="border border-neutral-300 bg-white px-3 py-2 rounded text-sm">PDF</button>
                  <button type="button" onClick={() => (hayCambios ? setError('Guarda los cambios antes de descargar el Excel.') : exportarCorteClienteExcel(calc, proyecto))} className="border border-neutral-300 bg-white px-3 py-2 rounded text-sm">Excel</button>
                  {abierto && (
                    <>
                      <button type="button" disabled={trabajando} onClick={anular} className="border border-red-200 text-red-700 px-3 py-2 rounded text-sm disabled:opacity-50">Anular</button>
                      <button type="button" disabled={trabajando || !hayCambios} onClick={guardar} className="bg-dorado text-white px-4 py-2 rounded text-sm disabled:opacity-40">
                        {trabajando ? 'Guardando…' : 'Guardar'}
                      </button>
                      <button type="button" disabled={trabajando} onClick={cerrar} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">Cerrar corte</button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-500 block mb-1">Fecha del corte</label>
                  <input type="date" disabled={!abierto} value={meta.fecha} onChange={(e) => setMeta({ ...meta, fecha: e.target.value })} className="border rounded px-3 py-2 text-sm w-full disabled:bg-neutral-50" />
                  <p className="text-[11px] text-neutral-400 mt-1">Los pagos del cliente se toman hasta esta fecha.</p>
                </div>
                <label className={`flex items-start gap-2 text-sm rounded border p-3 ${final ? 'border-dorado bg-[#b88a52]/10' : ''}`}>
                  <input type="checkbox" disabled={!abierto} checked={final} onChange={(e) => setMeta({ ...meta, es_final: e.target.checked })} className="mt-1" />
                  <span><strong>Liquidación final</strong><br /><span className="text-xs text-neutral-500">Último corte: muestra diferencias contra lo contratado. Al cerrarla no se crean más cortes.</span></span>
                </label>
                <div>
                  <label className="text-[11px] text-neutral-500 block mb-1">Observaciones (salen en el acta)</label>
                  <textarea disabled={!abierto} rows={2} value={meta.notas} onChange={(e) => setMeta({ ...meta, notas: e.target.value })} className="border rounded px-3 py-2 text-sm w-full disabled:bg-neutral-50" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tarjeta titulo="Valor de este corte" valor={pesos(calc.tot.este)} tono="bg-[#f3e9dc]" />
              <Tarjeta titulo="Total liquidado acumulado" valor={pesos(calc.tot.acumulado)} nota={`${pct1(calc.tot.contratado ? (calc.tot.acumulado / calc.tot.contratado) * 100 : 0)} de ${pesos(calc.tot.contratado)}`} />
              <Tarjeta titulo="Pagos del cliente" valor={pesos(calc.tot.pagos)} nota={`${(calc.pagos || []).length} pagos hasta ${fechaCC(meta.fecha)}`} tono="bg-green-50 text-green-900" />
              <Tarjeta titulo={calc.tot.saldo < 0 ? 'Saldo a favor del cliente' : 'Saldo a pagar por el cliente'} valor={pesos(Math.abs(calc.tot.saldo))}
                tono={calc.tot.saldo < 0 ? 'bg-green-50 text-green-900' : 'bg-carbon text-hueso'} />
            </div>
            {hayCambios && abierto && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">Hay cambios sin guardar. Los valores ya se ven recalculados; guarda para que queden en el corte.</p>}

            {/* 074: un solo cuadro con la estructura del Excel (control presupuestal de AD): todos los capítulos e ítems,
                un bloque por corte (los cerrados solo lectura, el abierto editable), el acumulado y el avance. */}
            <TablaControlCorteCliente calc={calc} abierto={abierto} edic={edic} setCap={setCap} setItem={setItem}
              cerrados={cerrados} setCerrados={setCerrados} final={final} />
            <p className="text-xs text-neutral-500">
              <strong>Cantidades:</strong> escribe en la columna del corte abierto lo ejecutado en este corte (&quot;Todo&quot; completa lo que falta del ítem).
              {' '}<strong>Global:</strong> escribe en la fila del capítulo el % de avance de ESTE corte (se suma al anterior); sus ítems se reparten en proporción.
              {' '}Los pagos directos del cliente se muestran pero no suman.
            </p>

            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-sm mb-2">Pagos del cliente registrados en Caja (hasta {fechaCC(meta.fecha)})</h3>
              {(calc.pagos || []).length === 0 ? <p className="text-sm text-neutral-500">Sin pagos registrados.</p> : (
                <div className="divide-y text-sm">
                  {calc.pagos.map((p, i) => (
                    <div key={i} className="flex justify-between gap-3 py-1.5">
                      <span><span className="text-neutral-500 mr-2">{fechaCC(p.fecha)}</span>{p.concepto}</span>
                      <span className="tabular-nums text-green-800">{pesos(p.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-neutral-400 mt-2">Si falta un pago, regístralo en Caja → Registrar movimiento → Ingreso del cliente.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
