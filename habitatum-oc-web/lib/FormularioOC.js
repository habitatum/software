'use client';
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
  calculo,
  onSubmit, guardando, error, tituloBoton,
}) {
  function actualizarItem(i, campo, valor) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
  }
  function agregarItem() {
    setItems((prev) => [...prev, { descripcion: '', unidad: '', cantidad: 1, valor_unitario: 0 }]);
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
          <table className="w-full text-sm border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '4%' }} />
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
                const porcentaje = calculo.subtotal > 0 ? (subtotalItem / calculo.subtotal) * 100 : 0;
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
                      <select value={it.presupuesto_item_id || ''}
                        onChange={(e) => actualizarItem(i, 'presupuesto_item_id', e.target.value || null)}
                        className={INPUT}>
                        <option value="">— Sin vincular —</option>
                        {presupuestoCapitulos.map((cap) => (
                          <optgroup key={cap.id} label={`${cap.codigo} · ${cap.nombre}`}>
                            {(cap.presupuesto_items || []).map((pi) => (
                              <option key={pi.id} value={pi.id}>{pi.codigo} · {pi.descripcion}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
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
          <span>{formatoPesos(calculo.subtotal)}</span>
        </div>
      </Seccion>

      {/* Impuestos */}
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

      {/* Anticipo / Amortización */}
      <Seccion titulo="Anticipo y amortización">
        <div className="grid grid-cols-2 gap-4">
          <Campo label="Tipo de pago">
            <select value={oc.tipo_pago} onChange={(e) => setOc({ ...oc, tipo_pago: e.target.value })} className={INPUT}>
              <option value="NORMAL">Normal</option>
              <option value="ANTICIPO">Anticipo</option>
            </select>
          </Campo>
          {oc.tipo_pago === 'ANTICIPO' && (
            <Campo label="% que representa del contrato">
              <input type="number" value={oc.porcentaje_anticipo} onChange={(e) => setOc({ ...oc, porcentaje_anticipo: e.target.value })} className={INPUT} />
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
            </Campo>
            <Campo label="% Amortización">
              <input type="number" value={oc.porcentaje_amortizacion} onChange={(e) => setOc({ ...oc, porcentaje_amortizacion: e.target.value })} className={INPUT} />
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
          <FilaResumen label="Subtotal" valor={calculo.subtotal} />
          {Number(oc.descuento) > 0 && <FilaResumen label="- Descuento" valor={oc.descuento} negativo />}
          {oc.tipo_impuesto === 'CON_IVA' && (
            <FilaResumen label={`+ IVA (${oc.porcentaje_iva || 0}%)`} valor={calculo.valor_iva} />
          )}
          {oc.tipo_impuesto === 'CON_AIU' && (
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
    </form>
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
