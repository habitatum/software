'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function DetalleOrdenCompra() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [oc, setOc] = useState(null);
  const [items, setItems] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [acumulados, setAcumulados] = useState(null);
  const [nuevoPago, setNuevoPago] = useState({ fecha: new Date().toISOString().slice(0, 10), valor: '', nota: '' });

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: ocData } = await supabase
      .from('v_ordenes_compra_calculadas')
      .select('*, proveedores(*), contratos(numero_contrato)')
      .eq('id', id).single();
    const { data: itemsData } = await supabase.from('items_oc').select('*').eq('orden_compra_id', id).order('id');
    const { data: pagosData } = await supabase.from('pagos').select('*').eq('orden_compra_id', id).order('fecha');
    setOc(ocData);
    setItems(itemsData || []);
    setPagos(pagosData || []);
    if (ocData?.contrato_id) {
      const { data: acum } = await supabase.from('v_acumulados_contrato').select('*').eq('contrato_id', ocData.contrato_id).single();
      setAcumulados(acum);
    } else {
      setAcumulados(null);
    }
  }

  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  async function registrarPago(e) {
    e.preventDefault();
    const supabase = crearClienteSupabase();
    await supabase.from('pagos').insert({
      orden_compra_id: id, fecha: nuevoPago.fecha, valor: nuevoPago.valor,
      nota: nuevoPago.nota, registrado_por: usuario.id,
    });
    setNuevoPago({ fecha: new Date().toISOString().slice(0, 10), valor: '', nota: '' });
    cargar();
  }

  if (cargando || !usuario || !oc) return null;

  // Recuadro destacado: igual lógica que el sistema anterior (Apps Script).
  let recuadro = { color: 'green', titulo: 'PAGADA EN SU TOTALIDAD', valor: 0 };
  if ((oc.pagado || 0) <= 0) {
    recuadro = { color: 'amber', titulo: 'VALOR A PAGAR AHORA', valor: oc.neto_a_pagar };
  } else if ((oc.saldo || 0) > 0) {
    recuadro = { color: 'red', titulo: 'SALDO PENDIENTE POR TRANSFERIR', valor: oc.saldo };
  }
  const coloresRecuadro = {
    amber: 'bg-amber-50 border-amber-300 text-amber-900',
    red: 'bg-red-50 border-red-300 text-red-900',
    green: 'bg-green-50 border-green-300 text-green-900',
  };

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{oc.folio}</h1>
            {oc.estado === 'ANULADA' && <span className="text-xs font-medium text-red-600">ANULADA</span>}
          </div>
          <a href={`/api/ordenes-compra/${id}/pdf`} target="_blank" rel="noreferrer"
            className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
            Descargar PDF
          </a>
        </div>

        <div className={`rounded-lg border p-4 flex items-center justify-between ${coloresRecuadro[recuadro.color]}`}>
          <span className="font-medium text-sm">{recuadro.titulo}</span>
          <span className="text-xl font-semibold">{formatoPesos(recuadro.valor)}</span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 gap-3 text-sm">
          <Dato label="Proveedor" valor={oc.proveedores?.nombre} />
          <Dato label="NIT" valor={oc.proveedores?.nit} />
          <Dato label="Contrato" valor={oc.contratos?.numero_contrato ?? '—'} />
          <Dato label="Fecha" valor={oc.fecha} />
          <Dato label="Tipo de orden" valor={oc.tipo_orden} />
          <Dato label="Capítulo" valor={oc.capitulo} />
          <Dato label="Responsable" valor={oc.responsable} />
          <Dato label="Tipo de pago" valor={oc.tipo_pago} />
          {oc.descripcion && <div className="col-span-2"><Dato label="Descripción" valor={oc.descripcion} /></div>}
          {oc.notas && <div className="col-span-2"><Dato label="Notas" valor={oc.notas} /></div>}
        </div>

        {/* Ítems */}
        <div className="bg-white rounded-lg shadow-sm border p-5">
          <h2 className="font-medium mb-3">Ítems</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="pb-2 font-medium">Descripción</th>
                  <th className="pb-2 font-medium w-20">Unidad</th>
                  <th className="pb-2 font-medium w-24 text-right">Cantidad</th>
                  <th className="pb-2 font-medium w-32 text-right">Precio unitario</th>
                  <th className="pb-2 font-medium w-32 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="py-1.5 pr-2">{it.descripcion}</td>
                    <td className="py-1.5 pr-2">{it.unidad || '—'}</td>
                    <td className="py-1.5 pr-2 text-right">{it.cantidad}</td>
                    <td className="py-1.5 pr-2 text-right">{formatoPesos(it.valor_unitario)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium whitespace-nowrap">{formatoPesos(it.cantidad * it.valor_unitario)}</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td className="py-2 text-neutral-400" colSpan={5}>Sin ítems.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Esta Orden: resumen completo, igual al sistema anterior */}
        <div className="bg-carbon text-hueso rounded-lg p-5">
          <h2 className="font-medium mb-3 text-gris-calido">Esta Orden</h2>
          <div className="text-sm space-y-1.5">
            <FilaResumen label="Subtotal" valor={oc.subtotal} />
            {Number(oc.descuento) > 0 && <FilaResumen label="- Descuento" valor={oc.descuento} negativo />}
            {oc.tipo_impuesto === 'CON_IVA' && (
              <FilaResumen label={`+ IVA (${oc.porcentaje_iva || 0}%)`} valor={oc.valor_iva} />
            )}
            {oc.tipo_impuesto === 'CON_AIU' && (
              <>
                <FilaResumen label={`+ AIU (${oc.porcentaje_aiu || 0}%)`} valor={oc.valor_aiu} />
                {Number(oc.porcentaje_administracion) > 0 && (
                  <FilaResumen label={`   · Administración (${oc.porcentaje_administracion}%)`} valor={oc.valor_administracion} sutil />
                )}
                {Number(oc.porcentaje_imprevistos) > 0 && (
                  <FilaResumen label={`   · Imprevistos (${oc.porcentaje_imprevistos}%)`} valor={oc.valor_imprevistos} sutil />
                )}
                {Number(oc.porcentaje_utilidad) > 0 && (
                  <FilaResumen label={`   · Utilidad (${oc.porcentaje_utilidad}%)`} valor={oc.valor_utilidad} sutil />
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
            <FilaResumen label="Pagado" valor={oc.pagado} sutil />
            <FilaResumen label="Saldo" valor={oc.saldo} destacado />
            {oc.tipo_pago === 'ANTICIPO' && (
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
            <div className="flex justify-between font-semibold border-t pt-2 mt-2"><span>Devolución acumulada</span><span>{formatoPesos(acumulados.devolucion_acumulada)}</span></div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border p-5">
          <h2 className="font-medium mb-3">Pagos registrados</h2>
          <table className="w-full text-sm mb-4">
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2">{p.fecha}</td>
                  <td className="py-2 text-right">{formatoPesos(p.valor)}</td>
                  <td className="py-2 text-neutral-500">{p.nota}</td>
                </tr>
              ))}
              {pagos.length === 0 && <tr><td className="py-2 text-neutral-400">Sin pagos registrados aún.</td></tr>}
            </tbody>
          </table>

          {usuario.rol !== 'lectura' && (
            <form onSubmit={registrarPago} className="flex gap-2 items-end">
              <div>
                <label className="block text-xs mb-1">Fecha</label>
                <input type="date" value={nuevoPago.fecha} onChange={(e) => setNuevoPago({ ...nuevoPago, fecha: e.target.value })} className="border rounded px-2 py-1 text-sm" />
              </div>
              <div>
                <label className="block text-xs mb-1">Valor</label>
                <input type="number" required value={nuevoPago.valor} onChange={(e) => setNuevoPago({ ...nuevoPago, valor: e.target.value })} className="border rounded px-2 py-1 text-sm" />
              </div>
              <div className="flex-1">
                <label className="block text-xs mb-1">Nota</label>
                <input value={nuevoPago.nota} onChange={(e) => setNuevoPago({ ...nuevoPago, nota: e.target.value })} className="border rounded px-2 py-1 text-sm w-full" />
              </div>
              <button className="bg-carbon text-hueso px-4 py-1.5 rounded text-sm">Registrar</button>
            </form>
          )}
        </div>
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
