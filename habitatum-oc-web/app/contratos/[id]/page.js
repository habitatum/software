'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function DetalleContrato() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [contrato, setContrato] = useState(null);
  const [acumulados, setAcumulados] = useState(null);
  const [ordenes, setOrdenes] = useState([]);

  useEffect(() => {
    if (!usuario) return;
    async function cargar() {
      const supabase = crearClienteSupabase();
      const { data: c } = await supabase.from('contratos').select('*, proveedores(nombre, nit)').eq('id', id).single();
      const { data: acum } = await supabase.from('v_acumulados_contrato').select('*').eq('contrato_id', id).single();
      const { data: oc } = await supabase.from('v_ordenes_compra_calculadas').select('*').eq('contrato_id', id).order('fecha');
      setContrato(c);
      setAcumulados(acum);
      setOrdenes(oc || []);
    }
    cargar();
  }, [usuario]); // eslint-disable-line

  if (cargando || !usuario || !contrato) return null;

  const valorPagado = (acumulados?.subtotal_acumulado || 0) - (acumulados?.retenido_acumulado || 0) + (acumulados?.devolucion_acumulada || 0);

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{contrato.numero_contrato}</h1>
          <a
            href={`/api/contratos/${id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="bg-carbon text-hueso px-4 py-2 rounded text-sm"
          >
            Descargar PDF
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-neutral-500">Contratista: </span>{contrato.proveedores?.nombre}</div>
          <div><span className="text-neutral-500">NIT: </span>{contrato.proveedores?.nit}</div>
          <div><span className="text-neutral-500">Concepto: </span>{contrato.concepto}</div>
          <div><span className="text-neutral-500">Valor inicial: </span>{formatoPesos(contrato.valor_inicial)}</div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-1">
          <h2 className="font-medium mb-2">Acumulados del contrato</h2>
          <div className="flex justify-between"><span>Subtotal acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados?.subtotal_acumulado)}</span></div>
          <div className="flex justify-between"><span>Retenido acumulado</span><span>{formatoPesos(acumulados?.retenido_acumulado)}</span></div>
          <div className="flex justify-between"><span>Devolución acumulada</span><span>{formatoPesos(acumulados?.devolucion_acumulada)}</span></div>
          <div className="flex justify-between font-semibold border-t pt-2 mt-2"><span>Valor pagado a la fecha</span><span>{formatoPesos(valorPagado)}</span></div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <h2 className="font-medium p-4 pb-0">Órdenes de Compra del contrato</h2>
          <table className="w-full text-sm mt-2">
            <thead className="bg-gris-calido/30 text-left"><tr><th className="p-3">Folio</th><th className="p-3">Fecha</th><th className="p-3">Tipo pago</th><th className="p-3 text-right">Total</th></tr></thead>
            <tbody>
              {ordenes.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-3"><Link href={`/ordenes-compra/${o.id}`} className="text-blue-700 hover:underline">{o.folio}</Link></td>
                  <td className="p-3">{o.fecha}</td>
                  <td className="p-3">{o.tipo_pago}</td>
                  <td className="p-3 text-right">{formatoPesos(o.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
