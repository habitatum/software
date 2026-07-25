'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function DetalleOrdenCompra() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual();
  const [oc, setOc] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [nuevoPago, setNuevoPago] = useState({ fecha: new Date().toISOString().slice(0, 10), valor: '', nota: '' });

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: ocData } = await supabase
      .from('v_ordenes_compra_calculadas')
      .select('*, proveedores(*), contratos(numero_contrato)')
      .eq('id', id).single();
    const { data: pagosData } = await supabase.from('pagos').select('*').eq('orden_compra_id', id).order('fecha');
    setOc(ocData);
    setPagos(pagosData || []);
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

  const saldo = (oc.subtotal || 0) - (oc.pagado || 0);

  return (
    <div>
      <NavBar usuario={usuario} />
      <main className="p-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{oc.folio}</h1>
          <a href={`/api/ordenes-compra/${id}/pdf`} target="_blank" rel="noreferrer"
            className="bg-neutral-900 text-white px-4 py-2 rounded text-sm">
            Descargar PDF
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 gap-3 text-sm">
          <Dato label="Proveedor" valor={oc.proveedores?.nombre} />
          <Dato label="NIT" valor={oc.proveedores?.nit} />
          <Dato label="Contrato" valor={oc.contratos?.numero_contrato ?? '—'} />
          <Dato label="Fecha" valor={oc.fecha} />
          <Dato label="Estado" valor={oc.estado} />
          <Dato label="Tipo de impuesto" valor={oc.tipo_impuesto} />
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-1">
          <Fila label="Subtotal" valor={oc.subtotal} />
          {oc.tipo_impuesto === 'CON_AIU' && <Fila label="Valor AIU" valor={oc.valor_aiu} />}
          <Fila label="Valor IVA" valor={oc.valor_iva} />
          <Fila label="Valor retenido" valor={oc.valor_retenido} />
          <Fila label="Pagado" valor={oc.pagado} />
          <Fila label="Saldo" valor={saldo} destacado />
        </div>

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
              <button className="bg-neutral-900 text-white px-4 py-1.5 rounded text-sm">Registrar</button>
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
function Fila({ label, valor, destacado }) {
  return (
    <div className={`flex justify-between ${destacado ? 'font-semibold text-base border-t pt-2 mt-2' : ''}`}>
      <span>{label}</span><span>{formatoPesos(valor)}</span>
    </div>
  );
}
