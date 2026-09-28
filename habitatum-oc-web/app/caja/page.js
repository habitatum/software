'use client';
import { useEffect, useState } from 'react';
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

function Tarjeta({ titulo, valor, nota, oscura, alerta }) {
  return (
    <div className={`${oscura ? 'bg-carbon text-hueso' : 'bg-white'} rounded-lg border p-4 border-t-2 ${alerta ? 'border-t-red-600' : 'border-t-dorado'}`}>
      <p className={`text-[11px] uppercase tracking-wide ${oscura ? 'text-gris-calido' : 'text-neutral-500'}`}>{titulo}</p>
      <p className={`text-lg font-semibold mt-1 ${alerta ? 'text-red-700' : ''}`}>{valor}</p>
      {nota && <p className={`text-xs mt-0.5 ${oscura ? 'text-gris-calido' : 'text-neutral-500'}`}>{nota}</p>}
    </div>
  );
}

function Fila({ etiqueta, valor, signo, fuerte, sub }) {
  return (
    <div className={`flex justify-between py-1.5 ${fuerte ? 'font-semibold border-t border-dorado mt-1 pt-2' : ''} ${sub ? 'pl-4 text-xs text-neutral-500' : 'text-sm'}`}>
      <span>{etiqueta}</span>
      <span>{signo === '-' && Number(valor) ? '− ' : signo === '+' ? '+ ' : ''}{formatoPesos(Math.abs(Number(valor) || 0))}</span>
    </div>
  );
}

export default function Caja() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mov, setMov] = useState({ tipo: 'INGRESO_CLIENTE', fecha: hoy(), valor: '', concepto: '', beneficiario: '' });
  const [conc, setConc] = useState({ fecha: hoy(), saldo_banco: '', nota: '' });
  const [hito, setHito] = useState({ concepto: '', valor: '', fecha_estimada: '' });
  const [cajaMenor, setCajaMenor] = useState([]);

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

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Caja del proyecto</h1>
          <p className="text-sm text-neutral-500">
            {proyecto.nombre} · Cuenta {d?.finanzas?.cuenta_receptora === 'PERSONAL' ? 'personal' : 'HABITATUM'} · Solo visible para administradores
          </p>
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}
        {!d ? <p className="text-sm text-neutral-500">Cargando caja...</p> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tarjeta oscura titulo="Saldo en libros" valor={formatoPesos(d.saldo_libros)} nota="Ingresos − egresos − retiros" />
              <Tarjeta
                titulo="Saldo real en banco"
                valor={c ? formatoPesos(c.saldo_banco) : 'Sin conciliar'}
                nota={c ? `Al ${fecha(c.fecha)} · diferencia ${Number(c.diferencia) < 0 ? '−' : '+'}${formatoPesos(Math.abs(c.diferencia))}` : 'Registra el saldo abajo'}
                alerta={c && Math.abs(Number(c.diferencia)) > 1}
              />
              <Tarjeta titulo="Por cobrar al cliente" valor={formatoPesos(d.por_cobrar)} nota={`De ${formatoPesos(d.contrato.total)} pactados`} />
              <Tarjeta
                titulo="Retiro máximo sugerido"
                valor={formatoPesos(c ? d.retiro_maximo_banco : d.retiro_maximo_libros)}
                nota={c ? `Sobre el saldo real${Number(d.deficit_banco) < 0 ? ` · déficit ${formatoPesos(Math.abs(d.deficit_banco))}` : ''}` : 'Sobre el saldo en libros'}
                alerta={c && Number(d.deficit_banco) < 0}
              />
            </div>

            {c && Number(d.deficit_banco) < 0 && (
              <div className="bg-red-50 border border-red-200 text-red-900 rounded p-3 text-sm">
                Con el saldo real de la cuenta, la obra está <strong>desfinanciada en {formatoPesos(Math.abs(d.deficit_banco))}</strong>:
                el dinero en banco más lo que falta por cobrar no alcanza para el costo pendiente y los retenidos por devolver.
                Con el saldo en libros, el retiro máximo sería {formatoPesos(d.retiro_maximo_libros)}. La diferencia de {formatoPesos(Math.abs(c.diferencia))} entre libros y banco debe explicarse.
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <section className="bg-white rounded-lg border p-4">
                <h2 className="font-semibold mb-2">Flujo de caja</h2>
                <Fila etiqueta="Ingresos del cliente" valor={d.ingresos} />
                <Fila etiqueta="Egresos de obra" valor={d.egresos.total} signo="-" />
                {Number(d.egresos.historico) > 0 && <Fila sub etiqueta="Histórico (formato anterior)" valor={d.egresos.historico} />}
                <Fila sub etiqueta="Órdenes de Compra" valor={d.egresos.ordenes_compra} />
                <Fila etiqueta="Retiros de utilidad" valor={d.retiros_utilidad} signo="-" />
                {Number(d.ajustes) !== 0 && <Fila etiqueta="Ajustes" valor={d.ajustes} signo={Number(d.ajustes) < 0 ? '-' : '+'} />}
                <Fila fuerte etiqueta="Saldo en libros" valor={d.saldo_libros} />
              </section>

              <section className="bg-white rounded-lg border p-4">
                <h2 className="font-semibold mb-2">Proyección al cierre</h2>
                <Fila etiqueta="Saldo en libros" valor={d.saldo_libros} />
                <Fila etiqueta="Por cobrar al cliente" valor={d.por_cobrar} signo="+" />
                <Fila etiqueta="Costo que falta por ejecutar" valor={comp.costo_por_ejecutar} signo="-" />
                <Fila etiqueta="Retenidos por devolver a contratistas" valor={comp.retenidos_por_devolver} signo="-" />
                <Fila fuerte etiqueta="Caja al cierre (utilidad por retirar)" valor={d.caja_proyectada_cierre} />
                <p className="text-[11px] text-neutral-500 mt-2">
                  Supone que se cobra todo lo pactado y cada capítulo consume su costo presupuestado (o lo ya ejecutado, si lo superó).
                </p>
              </section>
            </div>

            <section className="bg-white rounded-lg border p-4">
              <div className="flex items-baseline justify-between mb-2">
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

            <div className="grid md:grid-cols-2 gap-4">
              <section className="bg-white rounded-lg border p-4 space-y-2">
                <h2 className="font-semibold">Registrar movimiento</h2>
                <select value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value })} className={CAMPO}>
                  {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={mov.fecha} onChange={(e) => setMov({ ...mov, fecha: e.target.value })} className={CAMPO} />
                  <input type="number" placeholder={mov.tipo === 'AJUSTE' ? 'Valor (+ o −)' : 'Valor'} value={mov.valor} onChange={(e) => setMov({ ...mov, valor: e.target.value })} className={CAMPO} />
                </div>
                <input placeholder="Concepto" value={mov.concepto} onChange={(e) => setMov({ ...mov, concepto: e.target.value })} className={CAMPO} />
                {mov.tipo === 'RETIRO_UTILIDAD' && (
                  <input placeholder="Socio que recibe (ej. Andrés Hincapié)" value={mov.beneficiario} onChange={(e) => setMov({ ...mov, beneficiario: e.target.value })} className={CAMPO} />
                )}
                <button disabled={guardando} onClick={guardarMovimiento} className="bg-carbon text-hueso px-4 py-2 rounded text-sm w-full">{guardando ? 'Guardando...' : 'Guardar movimiento'}</button>
                <p className="text-[11px] text-neutral-500">Los egresos de obra no se registran aquí: salen automáticamente de las Órdenes de Compra.</p>
              </section>

              <section className="bg-white rounded-lg border p-4 space-y-2">
                <h2 className="font-semibold">Conciliar con el banco</h2>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={conc.fecha} onChange={(e) => setConc({ ...conc, fecha: e.target.value })} className={CAMPO} />
                  <input type="number" placeholder="Saldo real de la cuenta" value={conc.saldo_banco} onChange={(e) => setConc({ ...conc, saldo_banco: e.target.value })} className={CAMPO} />
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
            </div>

            <section className="bg-white rounded-lg border p-4">
              <div className="flex items-baseline justify-between mb-2 gap-3">
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

            <section className="bg-white rounded-lg border p-4">
              <h2 className="font-semibold mb-2">Movimientos (ingresos, retiros y ajustes)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">Fecha</th><th>Tipo</th><th>Concepto</th><th className="text-right">Valor</th><th /></tr></thead>
                  <tbody>
                    {d.movimientos.map((m) => (
                      <tr key={m.id} className="border-t">
                        <td className="py-2 whitespace-nowrap">{fecha(m.fecha)}</td>
                        <td className="whitespace-nowrap">{TIPOS[m.tipo]}</td>
                        <td>{m.concepto}{m.beneficiario ? ` · ${m.beneficiario}` : ''}</td>
                        <td className={`text-right whitespace-nowrap ${m.tipo === 'INGRESO_CLIENTE' ? 'text-green-700' : m.tipo === 'RETIRO_UTILIDAD' ? 'text-red-700' : ''}`}>
                          {m.tipo === 'RETIRO_UTILIDAD' ? '− ' : ''}{formatoPesos(m.valor)}
                        </td>
                        <td className="text-right"><button onClick={() => eliminarMovimiento(m)} className="text-xs text-neutral-400 hover:text-red-600">Eliminar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
