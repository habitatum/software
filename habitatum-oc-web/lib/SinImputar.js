'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';

// Bloque "Ejecutado sin imputar" del Presupuesto (administración delegada).
// Muestra lo pagado que no está cargado a ningún ítem del presupuesto
// (vista v_ejecutado_sin_imputar, migración 045). Usa la misma base del
// ejecutado del control: valor de la línea + su parte de IVA/AIU − descuento
// − retención neta. El código del presupuesto en los contratos es opcional:
// aquí se imputa después, línea por línea (solo administrador).
export default function SinImputar({ proyecto, usuario, capitulos, onCambio }) {
  const [lineas, setLineas] = useState([]);
  const [proveedores, setProveedores] = useState({});
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState({}); // item_oc_id -> presupuesto_item_id
  const [recordar, setRecordar] = useState({}); // item_oc_id -> boolean
  const [imputando, setImputando] = useState(null);
  const [error, setError] = useState('');
  const esAdmin = usuario?.rol === 'admin';

  async function cargar() {
    const s = crearClienteSupabase();
    const { data } = await s
      .from('v_ejecutado_sin_imputar')
      .select('*')
      .eq('proyecto_id', proyecto.id)
      .order('fecha', { ascending: false })
      .order('folio', { ascending: false });
    const filas = data || [];
    setLineas(filas);
    const ids = [...new Set(filas.map((l) => l.proveedor_id).filter(Boolean))];
    if (ids.length) {
      const { data: prov } = await s.from('proveedores').select('id, nombre').in('id', ids);
      const mapa = {};
      (prov || []).forEach((p) => { mapa[p.id] = p.nombre; });
      setProveedores(mapa);
    }
  }
  useEffect(() => { if (proyecto) cargar(); }, [proyecto]); // eslint-disable-line

  async function imputar(linea) {
    setError('');
    const presupuestoItemId = seleccion[linea.item_oc_id];
    if (!presupuestoItemId) { setError('Elija el ítem del presupuesto para esa línea.'); return; }
    setImputando(linea.item_oc_id);
    const s = crearClienteSupabase();
    const { error: e } = await s.rpc('imputar_linea_oc', {
      p_item_oc: linea.item_oc_id,
      p_presupuesto_item: presupuestoItemId,
      p_recordar: !!recordar[linea.item_oc_id],
    });
    setImputando(null);
    if (e) { setError(e.message); return; }
    await cargar();
    if (onCambio) onCambio();
  }

  const total = lineas.reduce((acc, l) => acc + Number(l.valor_sin_imputar || 0), 0);
  const ordenes = new Set(lineas.map((l) => l.oc_id)).size;

  return (
    <div className="bg-white rounded-lg shadow-sm border p-5 space-y-3 text-sm">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-neutral-500 text-xs mb-1">Ejecutado sin imputar (no presupuestado)</p>
          <p className={`text-lg font-semibold ${total > 0 ? 'text-amber-800' : 'text-carbon'}`}>{formatoPesos(total)}</p>
          <p className="text-[11px] text-neutral-400 mt-1 max-w-2xl">
            {total > 0
              ? `Pagado en ${ordenes} ${ordenes === 1 ? 'orden' : 'órdenes'} sin cargar a ningún ítem del presupuesto. No suma en el Ejecutado por ítems ni en el Total Control Presupuestal (para cobro).`
              : 'Todo lo pagado está cargado a ítems del presupuesto.'}
          </p>
        </div>
        {lineas.length > 0 && (
          <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
            className="border border-neutral-300 px-3 py-1.5 rounded text-xs whitespace-nowrap hover:bg-neutral-50 self-start">
            {abierto ? 'Ocultar líneas' : `Ver ${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'}`}
          </button>
        )}
      </div>

      {error && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded p-2">{error}</p>}

      {abierto && lineas.length > 0 && (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-left text-neutral-500 border-b">
                <th className="py-2 pr-2 font-medium">Orden</th>
                <th className="py-2 pr-2 font-medium">Fecha</th>
                <th className="py-2 pr-2 font-medium">Proveedor</th>
                <th className="py-2 pr-2 font-medium">Descripción</th>
                <th className="py-2 pr-2 font-medium text-right">Sin imputar</th>
                <th className="py-2 font-medium">{esAdmin ? 'Imputar a' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.item_oc_id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-2 whitespace-nowrap">
                    <Link href={`/ordenes-compra/${l.oc_id}`} className="text-blue-700 hover:underline">{l.folio}</Link>
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">{l.fecha ? new Date(`${l.fecha}T00:00:00`).toLocaleDateString('es-CO') : ''}</td>
                  <td className="py-2 pr-2">{proveedores[l.proveedor_id] || '—'}</td>
                  <td className="py-2 pr-2 max-w-[260px]">{l.descripcion}</td>
                  <td className="py-2 pr-2 text-right whitespace-nowrap font-medium">
                    {formatoPesos(l.valor_sin_imputar)}
                    {Number(l.pct_imputado) > 0 && (
                      <span className="block text-[10px] text-neutral-400 font-normal">imputada al {Math.round(Number(l.pct_imputado))}%</span>
                    )}
                  </td>
                  <td className="py-2">
                    {!esAdmin ? null : Number(l.pct_imputado) > 0 ? (
                      <Link href={`/ordenes-compra/${l.oc_id}/editar`} className="text-blue-700 hover:underline whitespace-nowrap">
                        Completar en la orden
                      </Link>
                    ) : (
                      <div className="space-y-1.5 min-w-[240px]">
                        <select
                          value={seleccion[l.item_oc_id] || ''}
                          onChange={(e) => setSeleccion({ ...seleccion, [l.item_oc_id]: e.target.value })}
                          className="border border-neutral-300 rounded px-2 py-1 w-full bg-white"
                          aria-label={`Ítem del presupuesto para ${l.descripcion}`}
                        >
                          <option value="">Elija el ítem del presupuesto</option>
                          {capitulos.map((c) => (
                            <optgroup key={c.id} label={`${c.codigo} ${c.nombre}`}>
                              {(c.presupuesto_items || []).map((it) => (
                                <option key={it.id} value={it.id}>{it.codigo} {it.descripcion}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {l.contrato_item_id && (
                          <label className="flex items-center gap-1.5 text-neutral-600 cursor-pointer">
                            <input type="checkbox" checked={!!recordar[l.item_oc_id]}
                              onChange={(e) => setRecordar({ ...recordar, [l.item_oc_id]: e.target.checked })} />
                            Recordar para los próximos cortes
                          </label>
                        )}
                        <button type="button" onClick={() => imputar(l)} disabled={imputando === l.item_oc_id || !seleccion[l.item_oc_id]}
                          className="bg-carbon text-hueso px-3 py-1 rounded disabled:opacity-40">
                          {imputando === l.item_oc_id ? 'Imputando...' : 'Imputar'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
