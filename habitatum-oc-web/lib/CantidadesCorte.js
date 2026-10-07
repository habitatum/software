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
export default function CantidadesCorte({ presupuesto, capitulos, cortes, corte, valoresEnCurso, puedeEditar, esAdmin = false, onClose, onGuardado }) {
  const [enCurso, setEnCurso] = useState({});
  // Valor pagado directo por el cliente sin OC (053), escrito para el corte en curso.
  const [directoEnCurso, setDirectoEnCurso] = useState({});
  const [cargando, setCargando] = useState(!corte);
  const [soloConValor, setSoloConValor] = useState(true);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const numero = corte ? corte.numero : cortes.length + 1;
  // Un corte cerrado ya se le presentó al cliente: sus cantidades se abren
  // bloqueadas y solo el admin las desbloquea, con doble confirmación.
  const [desbloqueado, setDesbloqueado] = useState(false);
  const editable = puedeEditar && (!corte || desbloqueado);
  // El valor pagado directo (sin OC) solo lo registra el admin.
  const editableDirecto = esAdmin && (!corte || desbloqueado);

  function desbloquear() {
    if (!window.confirm(`ADVERTENCIA: el Corte ${numero} ya está cerrado y se le presentó al cliente.\n\nCambiar sus cantidades modifica el documento entregado y los acumulados de los cortes siguientes. Los valores en pesos no cambian.\n\n¿Quieres desbloquear las cantidades para editarlas?`)) return;
    if (!window.confirm(`Confirma de nuevo: ¿desbloquear las cantidades del Corte ${numero}?\n\nCada cambio queda registrado con tu usuario y la fecha.`)) return;
    setDesbloqueado(true);
  }

  async function cargarEnCurso() {
    const { data } = await crearClienteSupabase().from('presupuesto_cantidades_en_curso')
      .select('presupuesto_item_id, cantidad, valor_directo').eq('presupuesto_id', presupuesto.id);
    const m = {}; const dir = {};
    (data || []).forEach((r) => {
      if (r.cantidad != null) m[r.presupuesto_item_id] = Number(r.cantidad);
      if (r.valor_directo != null) dir[r.presupuesto_item_id] = Number(r.valor_directo);
    });
    setEnCurso(m); setDirectoEnCurso(dir);
    setCargando(false);
  }
  useEffect(() => { if (!corte) cargarEnCurso(); }, [corte]); // eslint-disable-line

  // Cantidad y valor de este corte, y cantidad acumulada de los cortes anteriores.
  const { cantidadEste, valorEste, directoEste, acumAnterior } = useMemo(() => {
    const cant = {}; const val = {}; const dir = {}; const acum = {};
    if (corte) {
      (corte.items || []).forEach((ci) => {
        if (ci.cantidad_medida != null) cant[ci.presupuesto_item_id] = Number(ci.cantidad_medida);
        if (ci.valor_directo != null) dir[ci.presupuesto_item_id] = Number(ci.valor_directo);
        val[ci.presupuesto_item_id] = Number(ci.valor_ejecutado || 0); // ya incluye el valor directo
      });
    } else {
      Object.assign(cant, enCurso);
      Object.assign(dir, directoEnCurso);
      Object.entries(valoresEnCurso || {}).forEach(([id, v]) => { val[id] = Number(v.valor || 0); });
      Object.entries(directoEnCurso).forEach(([id, v]) => { val[id] = (val[id] || 0) + v; });
    }
    cortes.filter((c) => c.numero < numero).forEach((c) => (c.items || []).forEach((ci) => {
      if (ci.cantidad_medida != null) acum[ci.presupuesto_item_id] = (acum[ci.presupuesto_item_id] || 0) + Number(ci.cantidad_medida);
    }));
    return { cantidadEste: cant, valorEste: val, directoEste: dir, acumAnterior: acum };
  }, [corte, enCurso, directoEnCurso, valoresEnCurso, cortes, numero]);

  async function guardarDirecto(itemId, texto) {
    const limpio = String(texto ?? '').trim();
    const nuevo = limpio === '' ? null : Number(limpio);
    if (nuevo !== null && (Number.isNaN(nuevo) || nuevo < 0)) { setError('Escribe un valor mayor o igual a 0.'); return; }
    const anterior = directoEste[itemId] ?? null;
    if ((anterior || null) === (nuevo || null)) return;
    setError(''); setEstado('Guardando…');
    const { error: e } = await crearClienteSupabase().rpc('guardar_valor_directo', {
      p_presupuesto: presupuesto.id, p_item: itemId, p_valor: nuevo, p_corte: corte ? corte.id : null,
    });
    if (e) { setEstado(''); setError(e.message); return; }
    setEstado('Guardado'); setTimeout(() => setEstado(''), 1500);
    if (corte) { if (onGuardado) onGuardado(); } else await cargarEnCurso();
  }

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

  const conDatos = (id) => (valorEste[id] || 0) !== 0 || cantidadEste[id] != null || directoEste[id] != null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg max-w-6xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="bg-carbon text-hueso px-5 py-3 rounded-t-lg flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-dorado uppercase tracking-wide">Control presupuestal</p>
            <p className="font-semibold">Cantidades del Corte {numero}{corte ? ' (cerrado)' : ' (en curso)'}</p>
            <p className="text-xs text-gris-calido">
              {corte
                ? (desbloqueado ? 'Edición desbloqueada: solo se corrigen las cantidades; los valores del corte no cambian.' : 'Corte cerrado: cantidades bloqueadas.')
                : 'Escribe la cantidad medida de cada ítem antes de cerrar el corte. Se guarda al salir de la casilla.'}
              {estado && <span className="ml-2 text-green-300">· {estado}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {corte && puedeEditar && !desbloqueado && (
              <button type="button" onClick={desbloquear}
                className="text-xs border border-dorado text-dorado rounded px-3 py-1.5 hover:bg-white/10 whitespace-nowrap">
                🔒 Desbloquear para editar
              </button>
            )}
            {corte && desbloqueado && (
              <button type="button" onClick={() => setDesbloqueado(false)}
                className="text-xs border border-gris-calido text-hueso rounded px-3 py-1.5 hover:bg-white/10 whitespace-nowrap">
                Bloquear de nuevo
              </button>
            )}
            <button type="button" onClick={onClose} className="text-hueso hover:text-dorado text-lg leading-none px-2" aria-label="Cerrar">✕</button>
          </div>
        </div>
        {corte && desbloqueado && (
          <p role="alert" className="bg-amber-50 border-b border-amber-300 text-amber-900 text-xs px-5 py-2">
            Estás editando las cantidades del Corte {numero}, que ya se le presentó al cliente. Cada cambio queda registrado con tu usuario. Al cerrar esta ventana se vuelve a bloquear.
          </p>
        )}

        <div className="px-5 py-2 border-b flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={soloConValor} onChange={(e) => setSoloConValor(e.target.checked)} />
            Solo ítems con valor o cantidad en este corte
          </label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="overflow-auto">
          {cargando ? <p className="p-5 text-sm text-neutral-500">Cargando…</p> : (
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="sticky top-0 bg-gris-calido/40 text-left text-xs text-neutral-600">
                <tr>
                  <th className="p-2 w-16">Ítem</th><th className="p-2">Descripción</th><th className="p-2 w-12">Un</th>
                  <th className="p-2 w-24 text-right">Presupuesto</th><th className="p-2 w-28 text-right">Acum. anterior</th>
                  <th className="p-2 w-28 text-right">Este corte</th><th className="p-2 w-28 text-right">Acumulado</th>
                  <th className="p-2 w-36 text-right" title="Costos que el cliente paga directo y no tienen OC (ej. residente de obra). Se suman al valor del corte.">Pagado directo (sin OC)</th>
                  <th className="p-2 w-32 text-right">Valor del corte</th>
                </tr>
              </thead>
              <tbody>
                {capitulos.map((cap) => {
                  const items = (cap.presupuesto_items || []).filter((it) => !soloConValor || conDatos(it.id));
                  if (!items.length) return null;
                  return (
                    <Fragment key={cap.id}>
                      <tr className="bg-gris-calido/15 font-semibold text-xs"><td className="p-2" colSpan={9}>{cap.codigo} · {cap.nombre}</td></tr>
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
                              {editable ? (
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
                            <td className="p-1 text-right">
                              {editableDirecto ? (
                                <input key={`d-${it.id}-${directoEste[it.id] ?? ''}`} type="number" min="0" step="any" defaultValue={directoEste[it.id] ?? ''}
                                  aria-label={`Pagado directo sin OC del corte ${numero} · ${it.codigo}`}
                                  onBlur={(e) => guardarDirecto(it.id, e.target.value)}
                                  className="w-32 border rounded px-2 py-1 text-right bg-hueso/50 focus:bg-white" />
                              ) : (directoEste[it.id] ? <span className="tabular-nums">{formatoPesos(directoEste[it.id])}</span> : '—')}
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
