'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function DetalleOrdenCompra() {
  const { id } = useParams();
  const router = useRouter();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [oc, setOc] = useState(null);
  const [items, setItems] = useState([]);
  const [acumulados, setAcumulados] = useState(null);
  const [anticipoPendienteContrato, setAnticipoPendienteContrato] = useState(0);
  const [auditoria, setAuditoria] = useState(null);
  const [anulando, setAnulando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: ocData } = await supabase
      .from('v_ordenes_compra_calculadas')
      .select('*, proveedores(*), contratos(numero_contrato)')
      .eq('id', id).single();
    const { data: itemsData } = await supabase
      .from('items_oc')
      .select('*, presupuesto_items(codigo, descripcion)')
      .eq('orden_compra_id', id).order('orden').order('id');
    setOc(ocData);
    setItems(itemsData || []);
    if (ocData?.contrato_id) {
      const { data: acum } = await supabase.from('v_acumulados_contrato').select('*').eq('contrato_id', ocData.contrato_id).single();
      setAcumulados(acum);
      // Suma el saldo pendiente por amortizar de todos los Anticipos (vigentes)
      // que pertenecen a este mismo contrato, para mostrar cuánto anticipo
      // del contrato sigue sin cruzarse contra futuras Órdenes de Compra.
      const { data: anticiposContrato } = await supabase
        .from('v_ordenes_compra_calculadas')
        .select('saldo_anticipo_por_amortizar')
        .eq('contrato_id', ocData.contrato_id)
        .eq('tipo_pago', 'ANTICIPO')
        .neq('estado', 'ANULADA');
      const totalPendiente = (anticiposContrato || []).reduce(
        (acc, a) => acc + Number(a.saldo_anticipo_por_amortizar || 0), 0
      );
      setAnticipoPendienteContrato(totalPendiente);
    } else {
      setAcumulados(null);
      setAnticipoPendienteContrato(0);
    }
  }

  async function cargarAuditoria() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase
      .from('ordenes_compra')
      .select('creado_en, modificado_en, creador:usuarios!ordenes_compra_creado_por_fkey(nombre), modificador:usuarios!ordenes_compra_modificado_por_fkey(nombre)')
      .eq('id', id)
      .single();
    setAuditoria(data);
  }

  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line
  useEffect(() => { if (usuario?.rol === 'admin') cargarAuditoria(); }, [usuario]); // eslint-disable-line

  async function anularOrden() {
    if (!window.confirm('¿Confirmas anular esta Orden de Compra? Esta acción debe ser excepcional.')) return;
    setAnulando(true);
    const supabase = crearClienteSupabase();
    const { error } = await supabase.from('ordenes_compra').update({ estado: 'ANULADA' }).eq('id', id);
    setAnulando(false);
    if (error) { alert('No se pudo anular: ' + error.message); return; }
    cargar();
    cargarAuditoria();
  }

  async function eliminarOrden() {
    if (!window.confirm(
      `¿Eliminar definitivamente la Orden de Compra ${oc.folio}? Esta acción no se puede deshacer y se borrarán también sus ítems. El consecutivo de folio quedará libre para la próxima Orden de Compra.`
    )) return;
    setEliminando(true);
    const supabase = crearClienteSupabase();
    const { error } = await supabase.from('ordenes_compra').delete().eq('id', id);
    setEliminando(false);
    if (error) { alert('No se pudo eliminar: ' + error.message); return; }
    router.push('/ordenes-compra');
  }

  if (cargando || !usuario || !oc) return null;

  const esAnticipo = oc.tipo_pago === 'ANTICIPO';

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{oc.folio}</h1>
            {oc.estado === 'ANULADA' && <span className="text-xs font-medium text-red-600">ANULADA</span>}
          </div>
          <div className="flex items-center gap-2">
            {usuario.rol === 'admin' && oc.estado === 'VIGENTE' && (
              <button onClick={anularOrden} disabled={anulando}
                className="border border-red-300 text-red-700 px-4 py-2 rounded text-sm hover:bg-red-50 disabled:opacity-50">
                {anulando ? 'Anulando...' : 'Anular Orden de Compra'}
              </button>
            )}
            {usuario.rol === 'admin' && (
              <button onClick={eliminarOrden} disabled={eliminando}
                className="bg-red-700 text-white px-4 py-2 rounded text-sm hover:bg-red-800 disabled:opacity-50">
                {eliminando ? 'Eliminando...' : 'Eliminar OC'}
              </button>
            )}
            {usuario.rol !== 'lectura' && oc.estado === 'VIGENTE' && (
              <Link href={`/ordenes-compra/${id}/editar`}
                className="border border-neutral-300 px-4 py-2 rounded text-sm hover:bg-neutral-50">
                Editar
              </Link>
            )}
            <a href={`/api/ordenes-compra/${id}/pdf`} target="_blank" rel="noreferrer"
              className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              Descargar PDF
            </a>
          </div>
        </div>

        {usuario.rol === 'admin' && auditoria && (
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-xs text-neutral-500 space-y-0.5">
            <p>Creado por <span className="font-medium text-neutral-700">{auditoria.creador?.nombre ?? '—'}</span> el {new Date(auditoria.creado_en).toLocaleString('es-CO')}</p>
            {auditoria.modificado_en && (
              <p>Última modificación por <span className="font-medium text-neutral-700">{auditoria.modificador?.nombre ?? '—'}</span> el {new Date(auditoria.modificado_en).toLocaleString('es-CO')}</p>
            )}
          </div>
        )}

        <div className="rounded-lg border p-4 flex items-center justify-between bg-amber-50 border-amber-300 text-amber-900">
          <span className="font-medium text-sm">TOTAL A PAGAR</span>
          <span className="text-xl font-semibold">{formatoPesos(oc.neto_a_pagar)}</span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 gap-3 text-sm">
          <Dato label="Proveedor" valor={oc.proveedores?.nombre} />
          <Dato label="NIT" valor={oc.proveedores?.nit} />
          <Dato
            label="Cuenta"
            valor={
              oc.proveedores?.numero_cuenta
                ? `${oc.proveedores.numero_cuenta}${oc.proveedores?.tipo_cuenta ? ` (${oc.proveedores.tipo_cuenta})` : ''}`
                : null
            }
          />
          <Dato label="Banco" valor={oc.proveedores?.banco} />
          <Dato label="Contrato" valor={oc.contratos?.numero_contrato ?? '—'} />
          <Dato label="Fecha" valor={oc.fecha} />
          <Dato label="Tipo de orden" valor={oc.tipo_orden} />
          <Dato label="Responsable" valor={oc.responsable} />
          <Dato label="Tipo de pago" valor={oc.tipo_pago} />
          {oc.descripcion && <div className="col-span-2"><Dato label="Descripción" valor={oc.descripcion} /></div>}
          {oc.notas && <div className="col-span-2"><Dato label="Notas" valor={oc.notas} /></div>}
        </div>

        {/* Ítems */}
        <div className="bg-white rounded-lg shadow-sm border p-5">
          <h2 className="font-medium mb-3">Ítems</h2>
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-neutral-500 bg-gris-calido/30">
                  <th className="py-2 px-3 font-medium border-b border-neutral-200">Descripción</th>
                  <th className="py-2 px-3 font-medium border-b border-neutral-200 w-20">Unidad</th>
                  <th className="py-2 px-3 font-medium border-b border-neutral-200 w-24 text-right">Cantidad</th>
                  <th className="py-2 px-3 font-medium border-b border-neutral-200 w-32 text-right">Precio unitario</th>
                  <th className="py-2 px-3 font-medium border-b border-neutral-200 w-32 text-right">Subtotal</th>
                  <th className="py-2 px-3 font-medium border-b border-neutral-200 w-20 text-right">% Orden</th>
                  <th className="py-2 px-3 font-medium border-b border-neutral-200">Ítem de Presupuesto</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const subtotalItem = it.cantidad * it.valor_unitario;
                  const porcentaje = oc.subtotal_items > 0 ? (subtotalItem / oc.subtotal_items) * 100 : 0;
                  return (
                    <tr key={it.id} className={`${i % 2 === 1 ? 'bg-neutral-50/60' : ''} border-b border-neutral-100 last:border-b-0 hover:bg-hueso/60`}>
                      <td className="py-2 px-3">
                        {it.descripcion}
                        {it.sin_iva && <span className="ml-1.5 text-xs text-neutral-400">(Sin IVA)</span>}
                      </td>
                      <td className="py-2 px-3">{it.unidad || '—'}</td>
                      <td className="py-2 px-3 text-right">{it.cantidad}</td>
                      <td className="py-2 px-3 text-right">{formatoPesos(it.valor_unitario)}</td>
                      <td className="py-2 px-3 text-right font-medium whitespace-nowrap">{formatoPesos(subtotalItem)}</td>
                      <td className="py-2 px-3 text-right text-neutral-500 whitespace-nowrap">{porcentaje.toFixed(1)}%</td>
                      <td className="py-2 px-3 text-neutral-500">
                        {it.presupuesto_items ? `${it.presupuesto_items.codigo} · ${it.presupuesto_items.descripcion}` : '—'}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && <tr><td className="py-3 px-3 text-neutral-400" colSpan={7}>Sin ítems.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Esta Orden: resumen completo, igual al sistema anterior */}
        <div className="bg-carbon text-hueso rounded-lg p-5">
          <h2 className="font-medium mb-3 text-gris-calido">Esta Orden</h2>
          <div className="text-sm space-y-1.5">
            {esAnticipo && Number(oc.porcentaje_anticipo) > 0 && (
              <FilaResumen label="Valor ítems (base del anticipo)" valor={oc.subtotal_items} sutil />
            )}
            <FilaResumen
              label={esAnticipo && Number(oc.porcentaje_anticipo) > 0 ? `Anticipo (${oc.porcentaje_anticipo}% de los ítems)` : 'Subtotal'}
              valor={oc.subtotal}
            />
            {Number(oc.descuento) > 0 && <FilaResumen label="- Descuento" valor={oc.descuento} negativo />}
            {esAnticipo && (
              <p className="text-xs text-gris-calido/80 -mt-0.5">
                Los impuestos (IVA / AIU) no aplican a un Anticipo: se cobran en la orden Normal que lo amortiza.
              </p>
            )}
            {!esAnticipo && oc.tipo_impuesto === 'CON_IVA' && (
              <FilaResumen label={`+ IVA (${oc.porcentaje_iva || 0}%)`} valor={oc.valor_iva} />
            )}
            {!esAnticipo && oc.tipo_impuesto === 'CON_AIU' && (
              <>
                <FilaResumen label={`+ AIU (${oc.porcentaje_aiu || 0}%)`} valor={oc.valor_aiu} />
                {Number(oc.porcentaje_administracion) > 0 && (
                  <FilaResumen label={` · Administración (${oc.porcentaje_administracion}%)`} valor={oc.valor_administracion} sutil />
                )}
                {Number(oc.porcentaje_imprevistos) > 0 && (
                  <FilaResumen label={` · Imprevistos (${oc.porcentaje_imprevistos}%)`} valor={oc.valor_imprevistos} sutil />
                )}
                {Number(oc.porcentaje_utilidad) > 0 && (
                  <FilaResumen label={` · Utilidad (${oc.porcentaje_utilidad}%)`} valor={oc.valor_utilidad} sutil />
                )}
                {Number(oc.porcentaje_utilidad) > 0 && (
                  <FilaResumen label={`+ IVA sobre la Utilidad (${oc.porcentaje_iva || 0}%)`} valor={oc.valor_iva} />
                )}
              </>
            )}
            <FilaResumen label="TOTAL" valor={oc.total} destacado />
            {Number(oc.porcentaje_retencion) > 0 && (
              <FilaResumen label={`- Retenido (${oc.porcentaje_retencion}%)`} valor={oc.valor_retenido} negativo />
            )}
            {Number(oc.porcentaje_amortizacion) > 0 && (
              <FilaResumen label={`- Amortización anticipo (${oc.porcentaje_amortizacion}%)`} valor={oc.valor_amortizacion} negativo />
            )}
            {Number(oc.devolucion_retenido) > 0 && (
              <FilaResumen label="+ Devolución retenido" valor={oc.devolucion_retenido} />
            )}
            <FilaResumen label="A PAGAR" valor={oc.neto_a_pagar} destacado grande />
            {esAnticipo && (
              <FilaResumen label="Saldo del anticipo por amortizar" valor={oc.saldo_anticipo_por_amortizar} destacado />
            )}
          </div>
        </div>

        {/* Acumulados del contrato */}
        {oc.contrato_id && acumulados && (
          <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-1">
            <h2 className="font-medium mb-2">Acumulados del contrato ({oc.contratos?.numero_contrato})</h2>
            <div className="flex justify-between"><span>Subtotal acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados.subtotal_acumulado)}</span></div>
            <div className="flex justify-between"><span>Total acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados.total_acumulado)}</span></div>
            <div className="flex justify-between"><span>Retenido acumulado</span><span>{formatoPesos(acumulados.retenido_acumulado)}</span></div>
            <div className="flex justify-between"><span>Amortizado acumulado</span><span>{formatoPesos(acumulados.amortizado_acumulado)}</span></div>
            <div className="flex justify-between"><span>Anticipo pendiente por amortizar</span><span>{formatoPesos(anticipoPendienteContrato)}</span></div>
            <div className="flex justify-between"><span>Devolución acumulada</span><span>{formatoPesos(acumulados.devolucion_acumulada)}</span></div>
          </div>
        )}
      </main>
    </div>
  );
}

function Dato({ label, valor }) {
  return <div><span className="text-neutral-500">{label}: </span><span className="font-medium">{valor ?? '—'}</span></div>;
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
