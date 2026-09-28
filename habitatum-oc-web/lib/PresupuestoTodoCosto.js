'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { parsearPresupuesto } from '@/lib/parsePresupuesto';

// ============================================================
// Presupuesto y control presupuestal de proyectos TODO COSTO.
// Todos los datos salen de la función SQL control_todo_costo(proyecto):
//  - El ADMIN recibe costo, utilidad, finanzas y caja.
//  - Residentes / operativos solo reciben el valor total (precio de venta) y lo
//    ejecutado; el costo nunca llega a su navegador (se filtra en la base de datos).
// ============================================================

const TIPOS_CAPITULO = {
  CONTRATO: 'Contrato (con utilidad)',
  ADICIONAL_COSTO: 'Adicional sin utilidad',
  PAGO_DIRECTO_CLIENTE: 'Pago directo del cliente',
};

const MODALIDADES = { AIU: 'AIU con IVA sobre la utilidad', IVA: 'IVA sobre el total', SIN_FACTURA: 'Sin facturación' };

function pct(a, b) {
  const x = Number(b) > 0 ? (Number(a) / Number(b)) * 100 : 0;
  return Math.round(x * 10) / 10;
}

function Semaforo({ valor }) {
  const color = valor > 100 ? 'bg-red-600' : valor >= 85 ? 'bg-amber-500' : 'bg-green-600';
  const texto = valor > 100 ? 'Sobrecosto' : valor >= 85 ? 'Alerta' : 'OK';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
      {texto}
    </span>
  );
}

function Barra({ valor }) {
  return (
    <div className="h-1.5 bg-hueso rounded w-full min-w-[60px]">
      <div className={`h-1.5 rounded ${valor > 100 ? 'bg-red-600' : 'bg-dorado'}`} style={{ width: `${Math.min(valor, 100)}%` }} />
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, oscura }) {
  return (
    <div className={`${oscura ? 'bg-carbon text-hueso' : 'bg-white'} rounded-lg border p-4 border-t-2 border-t-dorado`}>
      <p className={`text-[11px] uppercase tracking-wide ${oscura ? 'text-gris-calido' : 'text-neutral-500'}`}>{titulo}</p>
      <p className="text-lg font-semibold mt-1">{valor}</p>
      {nota && <p className={`text-xs mt-0.5 ${oscura ? 'text-gris-calido' : 'text-neutral-500'}`}>{nota}</p>}
    </div>
  );
}

export default function PresupuestoTodoCosto({ usuario, proyecto }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [expandidos, setExpandidos] = useState({});
  const [guardandoTipo, setGuardandoTipo] = useState(null);
  const inputRef = useRef(null);
  const esAdmin = usuario?.rol === 'admin';

  async function cargar() {
    setCargando(true);
    const supabase = crearClienteSupabase();
    const { data, error: err } = await supabase.rpc('control_todo_costo', { p_proyecto: proyecto.id });
    if (err) setError(err.message);
    setDatos(data || null);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [proyecto.id]); // eslint-disable-line

  async function cambiarTipo(capituloId, tipo) {
    setGuardandoTipo(capituloId);
    setError('');
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('presupuesto_capitulos').update({ tipo_capitulo: tipo }).eq('id', capituloId);
    if (!err) {
      const { error: err2 } = await supabase.rpc('recalcular_venta_presupuesto', { p_proyecto: proyecto.id });
      if (err2) setError(err2.message);
    } else setError(err.message);
    setGuardandoTipo(null);
    cargar();
  }

  // El Excel se carga SIEMPRE a costo (mismo formato "FORMULARIO DE PRECIOS" de siempre).
  // El precio de venta lo calcula la base de datos con el margen del proyecto.
  async function subirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (datos?.presupuesto && !window.confirm('Ya existe un presupuesto. Subir uno nuevo REEMPLAZARÁ todos los capítulos e ítems (y sus imputaciones con Órdenes de Compra). ¿Continuar?')) {
      e.target.value = '';
      return;
    }
    setError('');
    setSubiendo(true);
    try {
      const d = parsearPresupuesto(await file.arrayBuffer());
      const supabase = crearClienteSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.from('presupuestos').delete().eq('proyecto_id', proyecto.id);
      const { data: pres, error: errP } = await supabase.from('presupuestos').insert({
        proyecto_id: proyecto.id, nombre_archivo: file.name,
        total_costos_directos: d.totales.totalCostosDirectos, total_costos_indirectos: d.totales.totalCostosIndirectos,
        valor_total: d.totales.valorTotal, cargado_por: session?.user?.id || null,
      }).select().single();
      if (errP) throw errP;
      const { data: caps, error: errC } = await supabase.from('presupuesto_capitulos').insert(
        d.capitulos.map((c) => ({ presupuesto_id: pres.id, codigo: c.codigo, nombre: c.nombre, categoria: c.categoria, valor_presupuestado: c.valor_presupuestado, orden: c.orden }))
      ).select('id, codigo');
      if (errC) throw errC;
      const idPorCodigo = Object.fromEntries(caps.map((c) => [c.codigo, c.id]));
      const filas = d.capitulos.flatMap((c) => c.items.map((it) => ({
        capitulo_id: idPorCodigo[c.codigo], codigo: it.codigo, descripcion: it.descripcion, unidad: it.unidad,
        cantidad: it.cantidad, valor_unitario: it.valor_unitario, valor_parcial: it.valor_parcial, orden: it.orden,
      })));
      if (filas.length) {
        const { error: errI } = await supabase.from('presupuesto_items').insert(filas);
        if (errI) throw errI;
      }
      const { error: errConv } = await supabase.rpc('convertir_presupuesto_a_todo_costo', { p_proyecto: proyecto.id });
      if (errConv) throw errConv;
      await cargar();
    } catch (err) {
      setError(err.message || 'No se pudo cargar el presupuesto.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (cargando && !datos) return <p className="text-sm text-neutral-500">Cargando presupuesto...</p>;

  const capitulos = datos?.capitulos || [];
  const t = datos?.totales || {};
  const fin = datos?.finanzas;
  const caja = datos?.caja;

  // Utilidad proyectada (admin): si un capítulo ya superó su costo, el sobrecosto se come utilidad;
  // si no, se asume que consumirá su costo presupuestado completo.
  const costoProyectado = capitulos.reduce((acc, c) => acc + Math.max(Number(c.costo || 0), Number(c.ejecutado || 0)), 0);
  const utilidadProyectada = Number(t.venta || 0) - costoProyectado;
  const margenPresupuestado = pct(t.utilidad_presupuestada, t.costo);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Presupuesto · Todo costo</h1>
          <p className="text-sm text-neutral-500">{proyecto.nombre}</p>
        </div>
        {esAdmin && (
          <div className="text-right">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" id="input-presupuesto-tc" onChange={subirArchivo} />
            <label htmlFor="input-presupuesto-tc" className="bg-carbon text-hueso px-4 py-2 rounded text-sm cursor-pointer inline-block">
              {subiendo ? 'Cargando...' : datos?.presupuesto ? 'Reemplazar presupuesto (Excel a costo)' : 'Cargar presupuesto (Excel a costo)'}
            </label>
            <p className="text-[11px] text-neutral-400 mt-1">El precio de venta se calcula con el margen del proyecto.</p>
          </div>
        )}
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

      {!datos?.presupuesto ? (
        <div className="bg-white rounded-lg shadow-sm border p-8 text-center text-neutral-500">
          <p>Este proyecto todavía no tiene un presupuesto cargado.</p>
        </div>
      ) : (
        <>
          {esAdmin ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tarjeta oscura titulo="Venta (contrato cliente)" valor={formatoPesos(t.venta)} nota={fin ? MODALIDADES[fin.modalidad_facturacion] : null} />
              <Tarjeta titulo="Costo presupuestado" valor={formatoPesos(t.costo)} nota={`Margen ${margenPresupuestado}% sobre costo`} />
              <Tarjeta titulo="Ejecutado (costo real)" valor={formatoPesos(t.ejecutado)} nota={`${pct(t.ejecutado, t.costo)}% del costo`} />
              <Tarjeta
                titulo="Utilidad proyectada"
                valor={formatoPesos(utilidadProyectada)}
                nota={`Presupuestada ${formatoPesos(t.utilidad_presupuestada)}${utilidadProyectada < Number(t.utilidad_presupuestada) ? ` · pérdida ${formatoPesos(Number(t.utilidad_presupuestada) - utilidadProyectada)}` : ''}`}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Tarjeta oscura titulo="Valor total del presupuesto" valor={formatoPesos(t.venta)} />
              <Tarjeta titulo="Avance ejecutado" valor={`${pct(t.ejecutado, t.venta)}%`} nota="Sobre el valor total" />
            </div>
          )}

          {esAdmin && caja && (
            <div className="bg-white rounded-lg border p-4 text-sm flex flex-wrap gap-x-8 gap-y-2">
              <span>Ingresos del cliente: <strong>{formatoPesos(caja.ingresos_cliente)}</strong></span>
              <span>Retiros de utilidad: <strong>{formatoPesos(caja.retiros_utilidad)}</strong></span>
              <span>Cuenta receptora: <strong>{fin?.cuenta_receptora === 'PERSONAL' ? 'Personal' : 'HABITATUM'}</strong></span>
              <span className="text-neutral-400">Caja, plan de pagos y conciliación: próxima fase</span>
            </div>
          )}

          {esAdmin && datos.historico && Number(datos.historico.movimientos) > 0 && (
            <div className="bg-hueso border border-gris-calido rounded p-3 text-xs text-neutral-600">
              Incluye <strong>{datos.historico.movimientos}</strong> pagos históricos por <strong>{formatoPesos(datos.historico.valor)}</strong>,
              cargados tal cual desde el formato financiero anterior (hasta {datos.historico.hasta}). Desde esa fecha, el ejecutado sale de las Órdenes de Compra.
            </div>
          )}
          {Number(datos.sin_imputar) > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-sm">
              Hay <strong>{formatoPesos(datos.sin_imputar)}</strong> en pagos sin capítulo del presupuesto asignado.
              Ese valor todavía no se refleja en el control por capítulo.
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gris-calido/30 text-left">
                {esAdmin ? (
                  <tr>
                    <th className="p-3">Capítulo</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3 text-right">Venta</th>
                    <th className="p-3 text-right">Costo</th>
                    <th className="p-3 text-right">Utilidad</th>
                    <th className="p-3 text-right">Ejecutado</th>
                    <th className="p-3 text-right">% costo</th>
                    <th className="p-3">Estado</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="p-3">Capítulo</th>
                    <th className="p-3 text-right">Valor total</th>
                    <th className="p-3 w-48">Avance</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {capitulos.map((c) => {
                  const abierto = !!expandidos[c.id];
                  const pctCosto = pct(c.ejecutado, c.costo);
                  const pctVenta = pct(c.ejecutado, c.venta);
                  return (
                    <Fragment key={c.id}>
                      <tr className="border-t hover:bg-hueso cursor-pointer" onClick={() => setExpandidos((p) => ({ ...p, [c.id]: !p[c.id] }))}>
                        <td className="p-3 font-medium">
                          <span className="text-neutral-400 mr-1">{abierto ? '▾' : '▸'}</span>
                          {c.codigo} · {c.nombre}
                        </td>
                        {esAdmin ? (
                          <>
                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={c.tipo}
                                disabled={guardandoTipo === c.id}
                                onChange={(e) => cambiarTipo(c.id, e.target.value)}
                                className="border rounded px-2 py-1 text-xs"
                              >
                                {Object.entries(TIPOS_CAPITULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </td>
                            <td className="p-3 text-right">{formatoPesos(c.venta)}</td>
                            <td className="p-3 text-right">{formatoPesos(c.costo)}</td>
                            <td className="p-3 text-right">{formatoPesos(c.utilidad_presupuestada)}</td>
                            <td className="p-3 text-right">{formatoPesos(c.ejecutado)}</td>
                            <td className="p-3 text-right">{pctCosto}%</td>
                            <td className="p-3"><Semaforo valor={pctCosto} /></td>
                          </>
                        ) : (
                          <>
                            <td className="p-3 text-right">{formatoPesos(c.venta)}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2"><Barra valor={pctVenta} /><span className="text-xs w-12 text-right">{pctVenta}%</span></div>
                            </td>
                          </>
                        )}
                      </tr>
                      {abierto && (c.items || []).map((it) => {
                        const pi = pct(it.ejecutado, esAdmin ? it.costo : it.venta);
                        return (
                          <tr key={it.id} className="border-t bg-neutral-50/60 text-xs">
                            <td className="p-2 pl-9">{it.codigo} · {it.descripcion}</td>
                            {esAdmin ? (
                              <>
                                <td className="p-2 text-neutral-400">{it.unidad || ''}{it.cantidad ? ` · ${it.cantidad}` : ''}</td>
                                <td className="p-2 text-right">{formatoPesos(it.venta)}</td>
                                <td className="p-2 text-right">{formatoPesos(it.costo)}</td>
                                <td className="p-2 text-right">{formatoPesos(Number(it.venta || 0) - Number(it.costo || 0))}</td>
                                <td className="p-2 text-right">{formatoPesos(it.ejecutado)}</td>
                                <td className="p-2 text-right">{pi}%</td>
                                <td className="p-2">{Number(it.ejecutado) > 0 && <Semaforo valor={pi} />}</td>
                              </>
                            ) : (
                              <>
                                <td className="p-2 text-right">{formatoPesos(it.venta)}</td>
                                <td className="p-2"><div className="flex items-center gap-2"><Barra valor={pi} /><span className="w-12 text-right">{pi}%</span></div></td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                      {abierto && Number(c.ejecutado_capitulo) > 0 && (
                        esAdmin ? (
                          <tr className="border-t bg-neutral-50/60 text-xs italic">
                            <td className="p-2 pl-9" colSpan={5}>Imputado al capítulo sin ítem específico</td>
                            <td className="p-2 text-right">{formatoPesos(c.ejecutado_capitulo)}</td>
                            <td colSpan={2} />
                          </tr>
                        ) : (
                          <tr className="border-t bg-neutral-50/60 text-xs italic">
                            <td className="p-2 pl-9" colSpan={3}>Incluye gastos imputados al capítulo sin ítem específico</td>
                          </tr>
                        )
                      )}
                    </Fragment>
                  );
                })}
                <tr className="border-t-2 border-dorado bg-hueso font-semibold">
                  <td className="p-3">Total</td>
                  {esAdmin ? (
                    <>
                      <td />
                      <td className="p-3 text-right">{formatoPesos(t.venta)}</td>
                      <td className="p-3 text-right">{formatoPesos(t.costo)}</td>
                      <td className="p-3 text-right">{formatoPesos(t.utilidad_presupuestada)}</td>
                      <td className="p-3 text-right">{formatoPesos(t.ejecutado)}</td>
                      <td className="p-3 text-right">{pct(t.ejecutado, t.costo)}%</td>
                      <td className="p-3"><Semaforo valor={pct(t.ejecutado, t.costo)} /></td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 text-right">{formatoPesos(t.venta)}</td>
                      <td className="p-3"><div className="flex items-center gap-2"><Barra valor={pct(t.ejecutado, t.venta)} /><span className="text-xs w-12 text-right">{pct(t.ejecutado, t.venta)}%</span></div></td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <p className="text-xs text-neutral-500">
              Semáforo contra el <strong>costo</strong> presupuestado: verde &lt; 85%, ámbar 85–100%, rojo &gt; 100% (sobrecosto que se come la utilidad).
              Los capítulos de tipo &quot;Adicional sin utilidad&quot; y &quot;Pago directo del cliente&quot; tienen venta = costo.
            </p>
          )}
        </>
      )}
    </div>
  );
}
