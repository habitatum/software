'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';

// Cantidades medidas del corte de cobro (052). Son las cantidades que se le
// presentan al cliente por ítem: el Excel del control presupuestal las toma de
// aquí y acumula corte a corte. La "cantidad" de las OC (materiales, jornales)
// no sirve para esto y no se usa.
// - corte = null → corte en curso (admin u operativo).
// - corte = { id, numero, items } → corte cerrado (solo el admin corrige).
export default function CantidadesCorte({ presupuesto, capitulos, cortes, corte, valoresEnCurso, puedeEditar, onClose, onGuardado }) {
  const [enCurso, setEnCurso] = useState({});
  const [cargando, setCargando] = useState(!corte);
  const [soloConValor, setSoloConValor] = useState(true);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const numero = corte ? corte.numero : cortes.length + 1;

  async function cargarEnCurso() {
    const { data } = await crearClienteSupabase().from('presupuesto_cantidades_en_curso')
      .select('presupuesto_item_id, cantidad').eq('presupuesto_id', presupuesto.id);
    const m = {};
    (data || []).forEach((r) => { m[r.presupuesto_item_id] = Number(r.cantidad); });
    setEnCurso(m);
    setCargando(false);
  }
  useEffect(() => { if (!corte) cargarEnCurso(); }, [corte]); // eslint-disable-line

  // Cantidad y valor de este corte, y cantidad acumulada de los cortes anteriores.
  const { cantidadEste, valorEste, acumAnterior } = useMemo(() => {
    const cant = {}; const val = {}; const acum = {};
    if (corte) {
      (corte.items || []).forEach((ci) => {
        if (ci.cantidad_medida != null) cant[ci.presupuesto_item_id] = Number(ci.cantidad_medida);
        val[ci.presupuesto_item_id] = Number(ci.valor_ejecutado || 0);
      });
    } else {
      Object.assign(cant, enCurso);
      Object.entries(valoresEnCurso || {}).forEach(([id, v]) => { val[id] = Number(v.valor || 0); });
    }
    cortes.filter((c) => c.numero < numero).forEach((c) => (c.items || []).forEach((ci) => {
      if (ci.cantidad_medida != null) acum[ci.presupuesto_item_id] = (acum[ci.presupuesto_item_id] || 0) + Number(ci.cantidad_medida);
    }));
    return { cantidadEste: cant, valorEste: val, acumAnterior: acum };
  }, [corte, enCurso, valoresEnCurso, cortes, numero]);

  async function guardar(itemId, texto) {
    const limpio = String(texto ?? '').trim().replace(',', '.');
    const nueva = limpio === '' ? null : Number(limpio);
    if (nueva !== null && (Number.isNaN(nueva) || nueva < 0)) { setError('Escribe un número mayor o igual a 0.'); return; }
    const anterior = cantidadEste[itemId] ?? null;
    if (anterior === nueva) return;
    setError(''); setEstado('Guardando…');
    const { error: e } = await crearClienteSupabase().rpc('guardar_cantidad_medida', {
      p_presupuesto: presupuesto.id, p_item: itemId, p_cantidad: nueva, p_corte: corte ? corte.id : null,
    });
    if (e) { setEstado(''); setError(e.message); return; }
    setEstado('Guardado'); setTimeout(() => setEstado(''), 1500);
    if (corte) { if (onGuardado) onGuardado(); } else await cargarEnCurso();
  }

  const conDatos = (id) => (valorEste[id] || 0) !== 0 || cantidadEste[id] != null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg max-w-6xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="bg-carbon text-hueso px-5 py-3 rounded-t-lg flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-dorado uppercase tracking-wide">Control presupuestal</p>
            <p className="font-semibold">Cantidades del Corte {numero}{corte ? ' (cerrado)' : ' (en curso)'}</p>
            <p className="text-xs text-gris-calido">
              {corte
                ? (puedeEditar ? 'Solo se corrigen las cantidades; los valores del corte no cambian.' : 'Consulta.')
                : 'Escribe la cantidad medida de cada ítem antes de cerrar el corte. Se guarda al salir de la casilla.'}
              {estado && <span className="ml-2 text-green-300">· {estado}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-hueso hover:text-dorado text-lg leading-none px-2" aria-label="Cerrar">✕</button>
        </div>

        <div className="px-5 py-2 border-b flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={soloConValor} onChange={(e) => setSoloConValor(e.target.checked)} />
            Solo ítems con valor o cantidad en este corte
          </label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="overflow-auto">
          {cargando ? <p className="p-5 text-sm text-neutral-500">Cargando…</p> : (
            <table className="w-full text-sm min-w-[860px]">
              <thead className="sticky top-0 bg-gris-calido/40 text-left text-xs text-neutral-600">
                <tr>
                  <th className="p-2 w-16">Ítem</th><th className="p-2">Descripción</th><th className="p-2 w-12">Un</th>
                  <th className="p-2 w-24 text-right">Presupuesto</th><th className="p-2 w-28 text-right">Acum. anterior</th>
                  <th className="p-2 w-28 text-right">Este corte</th><th className="p-2 w-28 text-right">Acumulado</th>
                  <th className="p-2 w-32 text-right">Valor del corte</th>
                </tr>
              </thead>
              <tbody>
                {capitulos.map((cap) => {
                  const items = (cap.presupuesto_items || []).filter((it) => !soloConValor || conDatos(it.id));
                  if (!items.length) return null;
                  return (
                    <Fragment key={cap.id}>
                      <tr className="bg-gris-calido/15 font-semibold text-xs"><td className="p-2" colSpan={8}>{cap.codigo} · {cap.nombre}</td></tr>
                      {items.map((it) => {
                        const pres = Number(it.cantidad || 0);
                        const ant = acumAnterior[it.id] || 0;
                        const este = cantidadEste[it.id];
                        const total = ant + (este || 0);
                        const pasa = pres > 0 && total > pres + 1e-9;
                        return (
                          <tr key={it.id} className="border-t">
                            <td className="p-2 text-neutral-600">{it.codigo}</td>
                            <td className="p-2">{it.descripcion}</td>
                            <td className="p-2 text-neutral-500">{it.unidad}</td>
                            <td className="p-2 text-right tabular-nums">{pres}</td>
                            <td className="p-2 text-right tabular-nums text-neutral-500">{ant || '—'}</td>
                            <td className="p-1 text-right">
                              {puedeEditar ? (
                                <input key={`${it.id}-${este ?? ''}`} type="number" min="0" step="any" defaultValue={este ?? ''}
                                  aria-label={`Cantidad del corte ${numero} · ${it.codigo}`}
                                  onBlur={(e) => guardar(it.id, e.target.value)}
                                  className="w-24 border rounded px-2 py-1 text-right bg-hueso/50 focus:bg-white" />
                              ) : (este ?? '—')}
                            </td>
                            <td className={`p-2 text-right tabular-nums font-medium ${pasa ? 'text-red-600' : ''}`}
                              title={pasa ? 'Supera la cantidad presupuestada' : ''}>
                              {total ? Number(total.toFixed(4)) : '—'}{pres > 0 && total ? <span className="block text-[10px] font-normal">{Math.round((total / pres) * 100)}%</span> : null}
                            </td>
                            <td className="p-2 text-right tabular-nums text-neutral-600">{valorEste[it.id] ? formatoPesos(valorEste[it.id]) : '—'}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end">
          <button type="button" onClick={onClose} className="bg-carbon text-hueso px-4 py-1.5 rounded text-sm">Listo</button>
        </div>
      </div>
    </div>
  );
}
