'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { exportarCobroCorte } from '@/lib/exportarCobroCortes';
import NavBar from '@/components/NavBar';

// 083 · Cortes de cobro de administración por Órdenes de Compra (administración delegada, solo admin).
// El corte en curso lo calcula la base de datos (cobro_corte_en_curso); cerrar lo congela (cerrar_cobro_corte).
const hoy = () => new Date().toISOString().slice(0, 10);
const fecha = (f) => { const p = String(f || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ''; };
const pesos = (v) => formatoPesos(Number(v) || 0);

function descargar({ blob, nombreArchivo }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function TablaLineas({ lineas }) {
  if (!lineas.length) return <p className="text-sm text-neutral-500 p-4">No hay órdenes de compra en este corte.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[900px]">
        <thead>
          <tr className="bg-dorado text-white text-left">
            {['Fecha', 'Folio', 'Contrato', 'Proveedor', 'Concepto', 'Total', 'A Pagar', 'Tipo', 'Estado'].map((t, i) => (
              <th key={t} className={`p-2 ${i === 5 || i === 6 ? 'text-right' : ''}`}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={`${l.orden_compra_id}-${i}`} className={`border-b border-neutral-100 ${l.tipo === 'AJUSTE' ? 'bg-amber-50' : ''}`}>
              <td className="p-2 whitespace-nowrap">{fecha(l.fecha)}</td>
              <td className="p-2 whitespace-nowrap"><a href={`/ordenes-compra/${l.orden_compra_id}`} className="underline">{l.folio}</a></td>
              <td className="p-2 whitespace-nowrap">{l.contrato || '—'}</td>
              <td className="p-2">{l.proveedor || '—'}</td>
              <td className="p-2">{l.concepto}{l.tipo === 'AJUSTE' && l.motivo ? <span className="block text-neutral-500">Motivo: {l.motivo}</span> : null}</td>
              <td className="p-2 text-right tabular-nums whitespace-nowrap">{l.tipo === 'AJUSTE' ? '' : pesos(l.total)}</td>
              <td className={`p-2 text-right tabular-nums whitespace-nowrap ${Number(l.a_pagar) < 0 ? 'text-red-700' : ''}`}>{pesos(l.a_pagar)}</td>
              <td className="p-2">{l.tipo === 'AJUSTE' ? 'AJUSTE' : (l.tipo_pago === 'ANTICIPO' ? 'Anticipo' : '')}</td>
              <td className="p-2">{l.estado_oc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CortesCobroOC() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [cortes, setCortes] = useState([]);
  const [curso, setCurso] = useState([]);
  const [anticipos, setAnticipos] = useState([]);
  const [pct, setPct] = useState('');
  const [fechaCorte, setFechaCorte] = useState(hoy());
  const [notas, setNotas] = useState('');
  const [verCorte, setVerCorte] = useState(null); // { corte, lineas }
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [metodoPresupuesto, setMetodoPresupuesto] = useState(false);
  const esAdmin = usuario?.rol === 'admin';

  async function cargar() {
    const s = crearClienteSupabase();
    setError('');
    const [{ data: cs }, { data: cu, error: e1 }, { data: ant }, { data: pr }, { data: pres }] = await Promise.all([
      s.from('cobro_cortes').select('*').eq('proyecto_id', proyecto.id).order('numero'),
      s.rpc('cobro_corte_en_curso', { p_proyecto: proyecto.id, p_fecha: null }),
      s.from('v_ordenes_compra_calculadas').select('id, fecha, folio, total, saldo_anticipo_por_amortizar, contratos(numero_contrato), proveedores(nombre)')
        .eq('proyecto_id', proyecto.id).eq('tipo_pago', 'ANTICIPO').neq('estado', 'ANULADA').order('fecha'),
      s.from('proyectos').select('porcentaje_administracion').eq('id', proyecto.id).single(),
      s.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
    ]);
    if (e1) setError(e1.message);
    setCortes(cs || []);
    setCurso(cu || []);
    setAnticipos((ant || []).map((a) => ({ ...a, contrato: a.contratos?.numero_contrato, proveedor: a.proveedores?.nombre })));
    setPct((p) => (p === '' ? String(Number(pr?.porcentaje_administracion || 0)) : p));
    if (pres) {
      const { data: pc } = await s.from('presupuesto_cortes').select('id').eq('presupuesto_id', pres.id).eq('estado', 'CERRADO').limit(1);
      setMetodoPresupuesto((pc || []).length > 0);
    }
  }
  useEffect(() => { if (esAdmin && proyecto?.id && proyecto.modelo_contratacion !== 'TODO_COSTO') cargar(); }, [esAdmin, proyecto?.id]); // eslint-disable-line

  const enCurso = curso.filter((l) => !fechaCorte || String(l.fecha).slice(0, 10) <= fechaCorte || l.tipo === 'AJUSTE');
  const base = enCurso.reduce((a, l) => a + Number(l.a_pagar || 0), 0);
  const totalOC = enCurso.reduce((a, l) => a + Number(l.total || 0), 0);
  const adm = Math.round(base * (Number(pct) || 0) / 100);
  const numero = (cortes.slice(-1)[0]?.numero || 0) + 1;
  const acumulado = cortes.reduce((a, c) => a + Number(c.valor_administracion), 0);

  async function cerrar() {
    if (!window.confirm(`¿Cerrar el Corte ${numero} al ${fecha(fechaCorte)}?\n\nBase ${pesos(base)} × ${pct} % = ${pesos(adm)} de administración.\nEl corte queda congelado y sus órdenes de compra bloqueadas (🔒). No se puede deshacer.`)) return;
    setTrabajando(true); setError(''); setAviso('');
    const { data, error: e } = await crearClienteSupabase().rpc('cerrar_cobro_corte', { p_proyecto: proyecto.id, p_fecha: fechaCorte, p_pct: Number(pct), p_notas: notas || null });
    setTrabajando(false);
    if (e) { setError(e.message); return; }
    setAviso(`Corte ${data.numero} cerrado: ${data.ocs} OC, base ${pesos(data.base)}, administración ${pesos(data.administracion)}.`);
    setNotas('');
    cargar();
  }
  async function abrirCorte(c) {
    const { data } = await crearClienteSupabase().from('cobro_corte_ocs').select('*').eq('corte_id', c.id).order('fecha').order('folio');
    setVerCorte({ corte: c, lineas: data || [] });
  }
  async function excel(c, lineas, abierto) {
    const r = await exportarCobroCorte({ proyecto, corte: c, lineas, anticipos, cortes: abierto ? cortes : cortes.filter((x) => x.numero <= c.numero), abierto });
    descargar(r);
  }

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;
  if (!esAdmin || proyecto.modelo_contratacion === 'TODO_COSTO') {
    return (<div><NavBar usuario={usuario} proyecto={proyecto} /><main className="p-8 text-center text-neutral-500">
      {!esAdmin ? 'Esta sección es solo para administradores.' : 'El cobro de administración por cortes aplica a obras de administración delegada.'}</main></div>);
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5">
        <div>
          <a href="/presupuesto" className="text-sm text-neutral-500 hover:text-carbon">← Presupuesto</a>
          <h1 className="text-2xl font-semibold mt-2">Cortes de cobro (Órdenes de Compra)</h1>
          <p className="text-sm text-neutral-500">{proyecto.nombre} · la administración se cobra sobre el A Pagar de las órdenes de compra</p>
        </div>
        {metodoPresupuesto && (
          <p className="bg-amber-50 border border-amber-300 text-sm rounded p-3">Esta obra ya cobra por cortes del control presupuestal. Para no cobrar dos veces, aquí solo se puede consultar: no se cierran cortes por OC.</p>
        )}
        {error && <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">{error}</p>}
        {aviso && <p className="bg-green-50 border border-green-200 text-green-800 text-sm rounded p-3">{aviso}</p>}

        <section className="bg-white border rounded-lg">
          <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 border-b">
            <div>
              <h2 className="font-semibold">Corte {numero} · en curso</h2>
              <p className="text-xs text-neutral-500">OC vigentes que no están en ningún corte cerrado, más los ajustes a OC ya cobradas.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label className="space-y-1"><span className="block text-xs text-neutral-600">Fecha de corte</span>
                <input type="date" value={fechaCorte} onChange={(e) => setFechaCorte(e.target.value)} className="border rounded px-2 py-1.5" /></label>
              <label className="space-y-1"><span className="block text-xs text-neutral-600">% administración</span>
                <input type="number" step="any" value={pct} onChange={(e) => setPct(e.target.value)} className="border rounded px-2 py-1.5 w-24 text-right" /></label>
            </div>
          </div>
          <TablaLineas lineas={enCurso} />
          <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm bg-hueso/50 border-t">
            <div><p className="text-xs text-neutral-500">Total OC</p><p className="font-semibold tabular-nums">{pesos(totalOC)}</p></div>
            <div><p className="text-xs text-neutral-500">Base (Σ A Pagar)</p><p className="font-semibold tabular-nums">{pesos(base)}</p></div>
            <div><p className="text-xs text-neutral-500">% administración</p><p className="font-semibold">{pct || 0} %</p></div>
            <div><p className="text-xs text-neutral-500">Administración a cobrar</p><p className="font-semibold tabular-nums text-lg">{pesos(adm)}</p></div>
          </div>
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-2 border-t">
            <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas del corte (opcional)" className="border rounded px-3 py-2 text-sm flex-1" />
            <button type="button" onClick={() => excel({ numero, fecha_corte: fechaCorte, pct_administracion: Number(pct) || 0 }, enCurso, true)} className="border px-4 py-2 rounded text-sm bg-white">Excel (vista previa)</button>
            <button type="button" disabled={trabajando || !enCurso.length || metodoPresupuesto} onClick={cerrar} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-40">
              {trabajando ? 'Cerrando…' : `Cerrar Corte ${numero}`}
            </button>
          </div>
        </section>

        <section className="bg-white border rounded-lg">
          <div className="p-4 sm:p-5 border-b flex justify-between items-center">
            <h2 className="font-semibold">Cortes cerrados</h2>
            <p className="text-sm">Administración cobrada: <span className="font-semibold">{pesos(acumulado)}</span></p>
          </div>
          {!cortes.length ? <p className="text-sm text-neutral-500 p-4">Todavía no hay cortes cerrados.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-left text-xs text-neutral-500 border-b">
                  <th className="p-3">Corte</th><th className="p-3">Fecha</th><th className="p-3 text-right">Total OC</th><th className="p-3 text-right">Base</th><th className="p-3 text-right">%</th><th className="p-3 text-right">Administración</th><th className="p-3" /></tr></thead>
                <tbody>
                  {[...cortes].reverse().map((c) => (
                    <tr key={c.id} className="border-b border-neutral-100">
                      <td className="p-3 font-medium">🔒 Corte {c.numero}</td>
                      <td className="p-3">{fecha(c.fecha_corte)}</td>
                      <td className="p-3 text-right tabular-nums">{pesos(c.total_ocs)}</td>
                      <td className="p-3 text-right tabular-nums">{pesos(c.base)}</td>
                      <td className="p-3 text-right">{Number(c.pct_administracion)} %</td>
                      <td className="p-3 text-right tabular-nums font-semibold">{pesos(c.valor_administracion)}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => abrirCorte(c)} className="text-xs underline mr-3">Ver</button>
                        <button type="button" onClick={async () => { const { data } = await crearClienteSupabase().from('cobro_corte_ocs').select('*').eq('corte_id', c.id).order('fecha').order('folio'); excel(c, data || [], false); }} className="text-xs underline">Excel</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {verCorte && (
          <section className="bg-white border rounded-lg">
            <div className="p-4 sm:p-5 border-b flex justify-between items-center">
              <h2 className="font-semibold">🔒 Corte {verCorte.corte.numero} · cerrado al {fecha(verCorte.corte.fecha_corte)}{verCorte.corte.notas ? ` · ${verCorte.corte.notas}` : ''}</h2>
              <button type="button" onClick={() => setVerCorte(null)} className="text-xs underline">Cerrar</button>
            </div>
            <TablaLineas lineas={verCorte.lineas} />
          </section>
        )}
      </main>
    </div>
  );
}
