'use client';
import { useState } from 'react';
import { formatoPesos } from '@/lib/calculosOC';

// Antes esto vivía como .input dentro de <style jsx global> con @apply, pero
// styled-jsx no pasa ese bloque por el pipeline de Tailwind: la clase nunca se
// generaba y los campos quedaban sin borde ("sueltos y flotando"). Usamos las
// clases de Tailwind directamente, igual que en el resto de la app.
const INPUT = 'border border-neutral-300 rounded-md px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-carbon/20 focus:border-carbon transition-colors';

// Unidades de medida disponibles para los ítems de una Orden de Compra.
const UNIDADES = ['Und', 'Glo', 'm2', 'm3', 'm', 'Gal', 'Kg', 'Hr', 'Día', 'Lt'];

// Formulario compartido entre Nueva Orden de Compra y Editar Orden de Compra.
export default function FormularioOC({
  oc, setOc, items, setItems,
  proveedores, contratos, anticipos, usuarios,
  presupuestoCapitulos = [],
  ejecutadosPresupuesto = {},
  calculo,
  onSubmit, guardando, error, tituloBoton,
}) {
  const esAnticipo = oc.tipo_pago === 'ANTICIPO';
  const [modalImputacionIndex, setModalImputacionIndex] = useState(null);

  function actualizarItem(i, campo, valor) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
  }
  function agregarItem() {
    setItems((prev) => [...prev, { descripcion: '', unidad: '', cantidad: 1, valor_unitario: 0, asignaciones: [] }]);
  }
  function quitarItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Datos generales */}
      <Seccion titulo="Datos generales">
        <div className="grid grid-cols-2 gap-4">
          <Campo label="Tipo de orden">
            <select value={oc.tipo_orden} onChange={(e) => setOc({ ...oc, tipo_orden: e.target.value })} className={INPUT}>
              <option value="COMPRA">Compra</option>
              <option value="SERVICIO">Servicio</option>
              <option value="CONTRATO">Contrato</option>
            </select>
          </Campo>
          <Campo label="Contrato (opcional)">
            <select value={oc.contrato_id} onChange={(e) => setOc({ ...oc, contrato_id: e.target.value })} className={INPUT}>
              <option value="">— Sin contrato —</option>
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.numero_contrato}{c.estado === 'ANULADO' ? ' (ANULADO)' : ''}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Proveedor">
            <select required value={oc.proveedor_id} onChange={(e) => setOc({ ...oc, proveedor_id: e.target.value })} className={INPUT}>
              <option value="">Selecciona...</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Fecha">
            <input type="date" value={oc.fecha} onChange={(e) => setOc({ ...oc, fecha: e.target.value })} className={INPUT} />
          </Campo>
          <Campo label="Responsable">
            <select value={oc.responsable || ''} onChange={(e) => setOc({ ...oc, responsable: e.target.value })} className={INPUT}>
              <option value="">— Sin asignar —</option>
              {usuarios.map((u) => <option key={u.id} value={u.nombre}>{u.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <Campo label="Descripción">
          <textarea value={oc.descripcion} onChange={(e) => setOc({ ...oc, descripcion: e.target.value })} className={INPUT} rows={2} />
        </Campo>
      </Seccion>

      {/* Ítems */}
      <Seccion titulo="Ítems">
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full min-w-[980px] text-sm border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '28.6%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '13.7%' }} />
              <col style={{ width: '10.3%' }} />
              <col style={{ width: '5.2%' }} />
              <col style={{ width: '19.8%' }} />
              <col style={{ width: '3.4%' }} />
            </colgroup>
            <thead>
              <tr className="text-left text-xs text-neutral-500 bg-gris-calido/30">
                <th className="py-2 px-3 font-medium border-b border-neutral-200">Descripción</th>
                <th className="py-2 px-3 font-medium border-b border-neutral-200">Unidad</th>
                <th className="py-2 px-3 font-medium border-b border-neutral-200 text-right">Cantidad</th>
                <th className="py-2 px-3 font-medium border-b border-neutral-200 text-right">Precio unitario</th>
                <th className="py-2 px-3 font-medium border-b border-neutral-200 text-right">Subtotal</th>
                <th className="py-2 px-3 font-medium border-b border-neutral-200 text-right">% Orden</th>
                <th className="py-2 px-3 font-medium border-b border-neutral-200">Ítem de Presupuesto</th>
                <th className="py-2 px-2 border-b border-neutral-200"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const subtotalItem = (Number(it.cantidad) || 0) * (Number(it.valor_unitario) || 0);
                const porcentaje = calculo.subtotalItems > 0 ? (subtotalItem / calculo.subtotalItems) * 100 : 0;
                return (
                  <tr key={i} className={`${i % 2 === 1 ? 'bg-neutral-50/60' : ''} border-b border-neutral-100 last:border-b-0`}>
                    <td className="py-2 px-3">
                      <input placeholder="Descripción" value={it.descripcion}
                        onChange={(e) => actualizarItem(i, 'descripcion', e.target.value)}
                        className={INPUT} />
                    </td>
                    <td className="py-2 px-3">
                      <select value={it.unidad || ''}
                        onChange={(e) => actualizarItem(i, 'unidad', e.target.value)}
                        className={INPUT}>
                        <option value="">—</option>
                        {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                        {it.unidad && !UNIDADES.includes(it.unidad) && (
                          <option value={it.unidad}>{it.unidad}</option>
                        )}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={it.cantidad}
                        onChange={(e) => actualizarItem(i, 'cantidad', e.target.value)}
                        className={`${INPUT} text-right`} />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={it.valor_unitario}
                        onChange={(e) => actualizarItem(i, 'valor_unitario', e.target.value)}
                        className={`${INPUT} text-right`} />
                    </td>
                    <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                      {formatoPesos(subtotalItem)}
                    </td>
                    <td className="py-2 px-3 text-right text-neutral-500 whitespace-nowrap">
                      {porcentaje.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3">
                      <button type="button" onClick={() => setModalImputacionIndex(i)}
                        className="text-xs border rounded px-2 py-1.5 w-full text-left hover:bg-gris-calido/20 truncate">
                        {resumenImputacion(it.asignaciones)}
                      </button>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button type="button" onClick={() => quitarItem(i)}
                        className="text-red-600 text-sm border border-red-200 rounded w-7 h-7 leading-none hover:bg-red-50">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={agregarItem}
          className="text-sm text-blue-700 border border-blue-200 rounded px-3 py-1.5 mt-3 hover:bg-blue-50">
          + Agregar ítem
        </button>
        <div className="bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 mt-3 flex justify-between text-sm font-semibold">
          <span>Subtotal ítems</span>
          <span>{formatoPesos(calculo.subtotalItems)}</span>
        </div>
        {esAnticipo && Number(oc.porcentaje_anticipo) > 0 && (
          <p className="text-xs text-neutral-500 mt-1">
            Esta orden es un anticipo del {oc.porcentaje_anticipo}% sobre el valor de los ítems: se paga {formatoPesos(calculo.subtotal)} de {formatoPesos(calculo.subtotalItems)}.
          </p>
        )}
      </Seccion>

      {/* Impuestos: no aplican a una Orden de Anticipo. El IVA/AIU se cobra
          en la(s) orden(es) Normal que amortizan ese anticipo, cada una con
          sus propios impuestos sobre lo que factura. */}
      {esAnticipo ? (
        <Seccion titulo="Impuestos">
          <p className="text-sm text-neutral-500">
            Los impuestos (IVA / AIU) no aplican a las Órdenes de Anticipo: se calculan y se suman en la orden Normal que amortiza este anticipo.
          </p>
        </Seccion>
      ) : (
        <Seccion titulo="Impuestos">
          <Campo label="Tipo de impuesto">
            <select value={oc.tipo_impuesto} onChange={(e) => setOc({ ...oc, tipo_impuesto: e.target.value })} className={INPUT}>
              <option value="SIN_IVA">Sin IVA</option>
              <option value="CON_IVA">Con IVA</option>
              <option value="CON_AIU">Con AIU</option>
            </select>
          </Campo>

          {oc.tipo_impuesto === 'CON_IVA' && (
            <Campo label="% IVA">
              <input type="number" value={oc.porcentaje_iva} onChange={(e) => setOc({ ...oc, porcentaje_iva: e.target.value })} className={INPUT} />
            </Campo>
          )}

          {oc.tipo_impuesto === 'CON_AIU' && (
            <div className="grid grid-cols-3 gap-4">
              <Campo label="% Administración">
                <input type="number" value={oc.porcentaje_administracion} onChange={(e) => setOc({ ...oc, porcentaje_administracion: e.target.value })} className={INPUT} />
              </Campo>
              <Campo label="% Imprevistos">
                <input type="number" value={oc.porcentaje_imprevistos} onChange={(e) => setOc({ ...oc, porcentaje_imprevistos: e.target.value })} className={INPUT} />
              </Campo>
              <Campo label="% Utilidad">
                <input type="number" value={oc.porcentaje_utilidad} onChange={(e) => setOc({ ...oc, porcentaje_utilidad: e.target.value })} className={INPUT} />
              </Campo>
              <Campo label="% IVA (solo sobre Utilidad)">
                <input type="number" value={oc.porcentaje_iva} onChange={(e) => setOc({ ...oc, porcentaje_iva: e.target.value })} className={INPUT} />
              </Campo>
            </div>
          )}

          <div className="bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 mt-2 text-sm text-neutral-600 space-y-1">
            {oc.tipo_impuesto === 'CON_AIU' && (
              <>
                <div className="flex justify-between"><span>Valor Administración</span><span>{formatoPesos(calculo.valor_administracion)}</span></div>
                <div className="flex justify-between"><span>Valor Imprevistos</span><span>{formatoPesos(calculo.valor_imprevistos)}</span></div>
                <div className="flex justify-between"><span>Valor Utilidad</span><span>{formatoPesos(calculo.valor_utilidad)}</span></div>
                <div className="flex justify-between"><span>Valor AIU total</span><span>{formatoPesos(calculo.valor_aiu)}</span></div>
              </>
            )}
            <div className="flex justify-between"><span>Valor IVA</span><span>{formatoPesos(calculo.valor_iva)}</span></div>
          </div>
        </Seccion>
      )}

      {/* Anticipo / Amortización */}
      <Seccion titulo="Anticipo y amortización">
        <div className="grid grid-cols-2 gap-4">
          <Campo label="Tipo de pago">
            <select value={oc.tipo_pago} onChange={(e) => setOc({ ...oc, tipo_pago: e.target.value })} className={INPUT}>
              <option value="NORMAL">Normal</option>
              <option value="ANTICIPO">Anticipo</option>
            </select>
          </Campo>
          {esAnticipo && (
            <Campo label="% que representa del contrato">
              <input type="number" step="0.0001" value={oc.porcentaje_anticipo} onChange={(e) => setOc({ ...oc, porcentaje_anticipo: e.target.value })} className={INPUT} />
            </Campo>
          )}
        </div>
        {oc.tipo_pago === 'NORMAL' && (
          <div className="grid grid-cols-2 gap-4">
            <Campo label="Referencia a anticipo (opcional)">
              <select value={oc.referencia_anticipo_id} onChange={(e) => setOc({ ...oc, referencia_anticipo_id: e.target.value })} className={INPUT}>
                <option value="">— Ninguna —</option>
                {anticipos.map((a) => <option key={a.id} value={a.id}>{a.folio}</option>)}
              </select>
              {oc.referencia_anticipo_id && (() => {
                const anticipoRef = anticipos.find((a) => String(a.id) === String(oc.referencia_anticipo_id));
                return anticipoRef ? (
                  <p className="text-xs text-neutral-500 mt-1">
                    Saldo pendiente por amortizar de {anticipoRef.folio}: {formatoPesos(Number(anticipoRef.saldo_anticipo_por_amortizar) || 0)}
                  </p>
                ) : null;
              })()}
            </Campo>
            <Campo label="Amortización de este anticipo">
              <div className="flex gap-4 mb-1.5 text-xs text-neutral-600">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={oc.tipo_amortizacion !== 'VALOR_FIJO'}
                    onChange={() => setOc({ ...oc, tipo_amortizacion: 'PORCENTAJE' })}
                  />
                  % del total
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={oc.tipo_amortizacion === 'VALOR_FIJO'}
                    onChange={() => setOc({ ...oc, tipo_amortizacion: 'VALOR_FIJO' })}
                  />
                  Monto fijo
                </label>
              </div>
              {oc.tipo_amortizacion === 'VALOR_FIJO' ? (
                <input type="number" value={oc.valor_amortizacion_manual} onChange={(e) => setOc({ ...oc, valor_amortizacion_manual: e.target.value })} className={INPUT} />
              ) : (
                <input type="number" step="0.0001" value={oc.porcentaje_amortizacion} onChange={(e) => setOc({ ...oc, porcentaje_amortizacion: e.target.value })} className={INPUT} />
              )}
            </Campo>
          </div>
        )}
        <div className="bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 mt-2 flex justify-between text-sm text-neutral-600">
          <span>Valor amortización</span><span>{formatoPesos(calculo.valor_amortizacion)}</span>
        </div>
      </Seccion>

      {/* Retención / descuento */}
      <Seccion titulo="Retención y descuento">
        <div className="grid grid-cols-3 gap-4">
          <Campo label="Descuento">
            <input type="number" value={oc.descuento} onChange={(e) => setOc({ ...oc, descuento: e.target.value })} className={INPUT} />
          </Campo>
          <Campo label="% Retención">
            <input type="number" value={oc.porcentaje_retencion} onChange={(e) => setOc({ ...oc, porcentaje_retencion: e.target.value })} className={INPUT} />
          </Campo>
          <Campo label="Devolución retenido">
            <input type="number" value={oc.devolucion_retenido} onChange={(e) => setOc({ ...oc, devolucion_retenido: e.target.value })} className={INPUT} />
          </Campo>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 mt-2 flex justify-between text-sm text-neutral-600">
          <span>Valor retenido</span><span>{formatoPesos(calculo.valor_retenido)}</span>
        </div>
      </Seccion>

      <Campo label="Notas">
        <textarea value={oc.notas} onChange={(e) => setOc({ ...oc, notas: e.target.value })} className={INPUT} rows={2} />
      </Campo>

      {/* Esta Orden: resumen completo, igual al sistema anterior */}
      <div className="bg-carbon text-hueso rounded-lg p-5">
        <h2 className="font-medium mb-3 text-gris-calido">Esta Orden</h2>
        <div className="text-sm space-y-1.5">
          {esAnticipo && Number(oc.porcentaje_anticipo) > 0 && (
            <FilaResumen label="Valor ítems (base del anticipo)" valor={calculo.subtotalItems} sutil />
          )}
          <FilaResumen
            label={esAnticipo && Number(oc.porcentaje_anticipo) > 0 ? `Anticipo (${oc.porcentaje_anticipo}% de los ítems)` : 'Subtotal'}
            valor={calculo.subtotal}
          />
          {Number(oc.descuento) > 0 && <FilaResumen label="- Descuento" valor={oc.descuento} negativo />}
          {!esAnticipo && oc.tipo_impuesto === 'CON_IVA' && (
            <FilaResumen label={`+ IVA (${oc.porcentaje_iva || 0}%)`} valor={calculo.valor_iva} />
          )}
          {!esAnticipo && oc.tipo_impuesto === 'CON_AIU' && (
            <>
              <FilaResumen label={`+ AIU (${calculo.porcentaje_aiu}%)`} valor={calculo.valor_aiu} />
              {Number(oc.porcentaje_administracion) > 0 && (
                <FilaResumen label={`   · Administración (${oc.porcentaje_administracion}%)`} valor={calculo.valor_administracion} sutil />
              )}
              {Number(oc.porcentaje_imprevistos) > 0 && (
                <FilaResumen label={`   · Imprevistos (${oc.porcentaje_imprevistos}%)`} valor={calculo.valor_imprevistos} sutil />
              )}
              {Number(oc.porcentaje_utilidad) > 0 && (
                <FilaResumen label={`   · Utilidad (${oc.porcentaje_utilidad}%)`} valor={calculo.valor_utilidad} sutil />
              )}
              {Number(oc.porcentaje_utilidad) > 0 && (
                <FilaResumen label={`+ IVA sobre la Utilidad (${oc.porcentaje_iva || 0}%)`} valor={calculo.valor_iva} />
              )}
            </>
          )}
          <FilaResumen label="TOTAL" valor={calculo.total} destacado />
          {Number(oc.porcentaje_retencion) > 0 && (
            <FilaResumen label={`- Retenido (${oc.porcentaje_retencion}%)`} valor={calculo.valor_retenido} negativo />
          )}
          {Number(oc.porcentaje_amortizacion) > 0 && (
            <FilaResumen label={`- Amortización anticipo (${oc.porcentaje_amortizacion}%)`} valor={calculo.valor_amortizacion} negativo />
          )}
          {Number(oc.devolucion_retenido) > 0 && (
            <FilaResumen label="+ Devolución retenido" valor={oc.devolucion_retenido} />
          )}
          <FilaResumen label="A PAGAR" valor={calculo.neto_a_pagar} destacado grande />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button type="submit" disabled={guardando} className="bg-carbon text-hueso px-6 py-3 rounded font-medium disabled:opacity-50">
        {guardando ? 'Guardando...' : tituloBoton}
      </button>
      {modalImputacionIndex !== null && items[modalImputacionIndex] && (
        <ModalImputacion
          item={items[modalImputacionIndex]}
          items={items}
          presupuestoCapitulos={presupuestoCapitulos}
          ejecutadosPresupuesto={ejecutadosPresupuesto}
          onChange={(nuevas) => actualizarItem(modalImputacionIndex, 'asignaciones', nuevas)}
          onClose={() => setModalImputacionIndex(null)}
        />
      )}
    </form>
  );
}

function resumenImputacion(asignaciones) {
  const validas = (asignaciones || []).filter((a) => a.presupuesto_item_id);
  if (validas.length === 0) return '— Sin vincular —';
  if (validas.length === 1) return '1 ítem · 100%';
  return `${validas.length} ítems del presupuesto`;
}

function ejecutadoConBorrador(presupuestoItemId, ejecutadosPresupuesto, items) {
  // Suma lo ya guardado en la base de datos (ejecutadosPresupuesto) MÁS lo que
  // ya está imputado a ese ítem del presupuesto en ESTE formulario, aunque
  // todavía no se haya guardado la Orden de Compra. Así el Ejecutado/Saldo
  // que se ve aquí queda al día apenas se carga un ítem, sin esperar a
  // guardar.
  const base = Number(ejecutadosPresupuesto[presupuestoItemId] || 0);
  let borrador = 0;
  (items || []).forEach((it) => {
    (it.asignaciones || []).forEach((a) => {
      if (a.presupuesto_item_id === presupuestoItemId) {
        const valorFila = Number(it.cantidad || 0) * Number(it.valor_unitario || 0);
        borrador += valorFila * (Number(a.porcentaje || 0) / 100);
      }
    });
  });
  return base + borrador;
}

// Desplegable propio (no <select> nativo) para poder alinear a la derecha y
// colorear Presupuestado/Ejecutado/Saldo de cada ítem — un <select> nativo no
// permite formato en sus <option>. Se expande hacia abajo dentro del mismo
// flujo (no flotante) para no quedar cortado por el scroll del modal.
function SelectorItemPresupuesto({ valor, presupuestoCapitulos, ejecutadosPresupuesto, items, onChange }) {
  const [abierto, setAbierto] = useState(false);
  const mapaItems = {};
  presupuestoCapitulos.forEach((cap) => {
    (cap.presupuesto_items || []).forEach((pi) => { mapaItems[pi.id] = pi; });
  });
  const seleccionado = valor ? mapaItems[valor] : null;

  return (
    <div className="flex-1">
      <button type="button" onClick={() => setAbierto(!abierto)}
        className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-full bg-white text-left flex items-center justify-between gap-2">
        <span className={`truncate ${seleccionado ? '' : 'text-neutral-400'}`}>
          {seleccionado ? `${seleccionado.codigo} · ${seleccionado.descripcion}` : '— Elegir ítem del presupuesto —'}
        </span>
        <span className="text-neutral-400 shrink-0">{abierto ? '▴' : '▾'}</span>
      </button>
      {abierto && (
        <div className="mt-1 border rounded-md shadow-sm max-h-72 overflow-y-auto bg-white">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-neutral-400 flex items-center justify-between gap-3 border-b sticky top-0 bg-white">
            <span>Ítem</span>
            <span className="flex items-center gap-3 shrink-0">
              <span className="w-20 text-right">Presup.</span>
              <span className="w-20 text-right">Ejec.</span>
              <span className="w-20 text-right">Saldo</span>
            </span>
          </div>
          <button type="button" onClick={() => { onChange(''); setAbierto(false); }}
            className="w-full text-left px-3 py-2 text-sm text-neutral-400 hover:bg-gris-calido/20 border-b">
            — Elegir ítem del presupuesto —
          </button>
          {presupuestoCapitulos.map((cap) => (
            <div key={cap.id}>
              <div className="px-3 py-1 text-xs font-semibold bg-gris-calido/20 text-carbon">
                {cap.codigo} · {cap.nombre}
              </div>
              {(cap.presupuesto_items || []).map((pi) => {
                const pres = Number(pi.valor_parcial || 0);
                const ejec = ejecutadoConBorrador(pi.id, ejecutadosPresupuesto, items);
                const sal = pres - ejec;
                const pct = pres > 0 ? ejec / pres : 0;
                const colorSaldo = sal < 0 ? 'text-red-600' : pct >= 0.9 ? 'text-amber-600' : 'text-green-600';
                return (
                  <button key={pi.id} type="button"
                    onClick={() => { onChange(pi.id); setAbierto(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gris-calido/20 flex items-center justify-between gap-3 ${valor === pi.id ? 'bg-dorado/10' : ''}`}>
                    <span className="truncate">{pi.codigo} · {pi.descripcion}</span>
                    <span className="flex items-center gap-3 text-xs shrink-0 tabular-nums">
                      <span className="text-neutral-500 w-20 text-right">{formatoPesos(pres)}</span>
                      <span className="text-blue-600 w-20 text-right">{formatoPesos(ejec)}</span>
                      <span className={`w-20 text-right font-medium ${colorSaldo}`}>{formatoPesos(sal)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModalImputacion({ item, items, presupuestoCapitulos, ejecutadosPresupuesto, onChange, onClose }) {
  const [asignaciones, setAsignaciones] = useState(item.asignaciones || []);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const valorItem = Number(item.cantidad || 0) * Number(item.valor_unitario || 0);
  const sumaPct = asignaciones.reduce((acc, a) => acc + Number(a.porcentaje || 0), 0);
  const necesitaPct = asignaciones.length > 1;
  const sumaOk = asignaciones.length === 0 || (necesitaPct ? Math.abs(sumaPct - 100) < 0.01 : true);
  const hayCambios = JSON.stringify(asignaciones) !== JSON.stringify(item.asignaciones || []);

  const mapaItems = {};
  presupuestoCapitulos.forEach((cap) => {
    (cap.presupuesto_items || []).forEach((pi) => { mapaItems[pi.id] = { ...pi, capituloCodigo: cap.codigo }; });
  });

  function actualizarFila(j, campo, valor) {
    setAsignaciones((prev) => prev.map((a, idx) => (idx === j ? { ...a, [campo]: valor } : a)));
  }
  function agregarFila() {
    setAsignaciones((prev) => {
      if (prev.length === 0) {
        return [{ presupuesto_item_id: '', porcentaje: 100 }];
      }
      if (prev.length === 1) {
        // Al pasar de 1 a 2 ítems, reparte 50/50 para que la suma siga en 100%.
        return [
          { ...prev[0], porcentaje: 50 },
          { presupuesto_item_id: '', porcentaje: 50 },
        ];
      }
      return [...prev, { presupuesto_item_id: '', porcentaje: 0 }];
    });
  }
  function quitarFila(j) {
    setAsignaciones((prev) => {
      const nuevas = prev.filter((_, idx) => idx !== j);
      // Si queda una sola fila, se asume 100% automáticamente.
      return nuevas.length === 1 ? [{ ...nuevas[0], porcentaje: 100 }] : nuevas;
    });
  }

  function intentarCerrar() {
    if (hayCambios) {
      setConfirmandoCierre(true);
    } else {
      onClose();
    }
  }
  function guardar() {
    onChange(asignaciones);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={intentarCerrar}>
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="bg-carbon text-hueso px-5 py-3 flex items-center justify-between rounded-t-lg sticky top-0">
          <div>
            <p className="font-semibold">Imputar al presupuesto</p>
            <p className="text-xs text-gris-calido">{item.descripcion || '(sin descripción)'} — {formatoPesos(valorItem)}</p>
          </div>
          <button type="button" onClick={intentarCerrar} className="text-hueso hover:text-dorado text-lg leading-none px-2">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {asignaciones.length === 0 && (
            <p className="text-sm text-neutral-500">Este ítem no está vinculado a ningún ítem del presupuesto.</p>
          )}
          {asignaciones.map((a, j) => {
            const info = mapaItems[a.presupuesto_item_id];
            const presupuestado = info ? Number(info.valor_parcial || 0) : 0;
            const ejecutado = a.presupuesto_item_id ? ejecutadoConBorrador(a.presupuesto_item_id, ejecutadosPresupuesto, items) : 0;
            const saldo = presupuestado - ejecutado;
            return (
              <div key={j} className="border rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <SelectorItemPresupuesto
                    valor={a.presupuesto_item_id || ''}
                    presupuestoCapitulos={presupuestoCapitulos}
                    ejecutadosPresupuesto={ejecutadosPresupuesto}
                    items={items}
                    onChange={(v) => actualizarFila(j, 'presupuesto_item_id', v)}
                  />
                  {necesitaPct && (
                    <input type="number" min="0" max="100" step="0.01" value={a.porcentaje}
                      onChange={(e) => actualizarFila(j, 'porcentaje', e.target.value)}
                      className="border border-neutral-300 rounded-md px-2 py-2 text-sm w-24 text-right" />
                  )}
                  {necesitaPct && <span className="text-sm text-neutral-500">%</span>}
                  <button type="button" onClick={() => quitarFila(j)}
                    className="text-red-600 text-sm border border-red-200 rounded w-7 h-7 leading-none hover:bg-red-50">✕</button>
                </div>
                {a.presupuesto_item_id && (
                  <div className="grid grid-cols-3 gap-2 text-xs text-neutral-500 bg-neutral-50 rounded p-2">
                    <div>Presupuestado<br /><span className="font-medium text-neutral-700">{formatoPesos(presupuestado)}</span></div>
                    <div>Ejecutado<br /><span className="font-medium text-neutral-700">{formatoPesos(ejecutado)}</span></div>
                    <div>Saldo<br /><span className={`font-medium ${saldo < 0 ? 'text-red-600' : 'text-neutral-700'}`}>{formatoPesos(saldo)}</span></div>
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" onClick={agregarFila}
            className="text-sm border rounded px-3 py-1.5 hover:bg-gris-calido/20">
            + Agregar ítem del presupuesto
          </button>
          {necesitaPct && (
            <p className={`text-sm ${sumaOk ? 'text-green-600' : 'text-red-600'}`}>
              Suma de porcentajes: {sumaPct.toFixed(1)}% {sumaOk ? '✓' : '— debe sumar 100% para poder guardar'}
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button type="button" onClick={intentarCerrar}
            className="border border-neutral-300 text-neutral-700 px-4 py-2 rounded text-sm hover:bg-neutral-50">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!sumaOk}
            className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
      {confirmandoCierre && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5 space-y-4">
            <p className="text-sm text-neutral-700">Tienes cambios sin guardar en la imputación de este ítem. ¿Deseas salir sin guardarlos?</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmandoCierre(false)}
                className="border border-neutral-300 text-neutral-700 px-3 py-1.5 rounded text-sm hover:bg-neutral-50">
                Seguir editando
              </button>
              <button type="button" onClick={onClose}
                className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700">
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
      <h2 className="font-medium text-neutral-800">{titulo}</h2>
      {children}
    </div>
  );
}
function Campo({ label, children }) {
  return (
    <div className="mb-2">
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function FilaResumen({ label, valor, destacado, grande, sutil, negativo }) {
  return (
    <div
      className={[
        'flex justify-between',
        destacado ? 'font-semibold border-t border-hueso/20 pt-1.5 mt-1' : '',
        grande ? 'text-lg text-dorado' : '',
        sutil ? 'text-gris-calido/80 text-xs' : '',
      ].join(' ')}
    >
      <span>{label}</span>
      <span>{negativo ? '-' : ''}{formatoPesos(valor)}</span>
    </div>
  );
}
