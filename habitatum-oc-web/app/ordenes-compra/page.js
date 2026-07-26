'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function ListadoOrdenesCompra() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [ordenes, setOrdenes] = useState([]);
  const [filtroEstado, setFiltroEstado] = useState('TODAS');
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargar() {
      const supabase = crearClienteSupabase();
      const { data } = await supabase
        .from('v_ordenes_compra_calculadas')
        .select('*, proveedores(nombre), contratos(numero_contrato)')
        .eq('proyecto_id', proyecto.id)
        .order('creado_en', { ascending: false });
      setOrdenes(data || []);
    }
    cargar();
  }, [usuario, proyecto]);

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  const filtradas = ordenes.filter((o) => {
    if (filtroEstado !== 'TODAS' && o.estado !== filtroEstado) return false;
    if (busqueda && !`${o.folio} ${o.proveedores?.nombre ?? ''}`.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Órdenes de Compra</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre}</p>
          </div>
          {usuario.rol !== 'lectura' && (
            <Link href="/ordenes-compra/nueva" className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              + Nueva Orden de Compra
            </Link>
          )}
        </div>

        <div className="flex gap-3 mb-4">
          <input
            placeholder="Buscar por folio o proveedor..."
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className="border rounded px-3 py-2 text-sm flex-1"
          />
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="border rounded px-3 py-2 text-sm">
            <option value="TODAS">Todos los estados</option>
            <option value="VIGENTE">Vigente</option>
            <option value="ANULADA">Anulada</option>
          </select>
        </div>

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left">
              <tr>
                <th className="p-3">Folio</th>
                <th className="p-3">Contrato</th>
                <th className="p-3">Proveedor</th>
                <th className="p-3">Fecha</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-right">A Pagar</th>
                <th className="p-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((o) => (
                <tr key={o.id} className="border-t hover:bg-hueso">
                  <td className="p-3">
                    <Link href={`/ordenes-compra/${o.id}`} className="text-blue-700 hover:underline">{o.folio}</Link>
                  </td>
                  <td className="p-3">{o.contratos?.numero_contrato ?? '—'}</td>
                  <td className="p-3">{o.proveedores?.nombre ?? '—'}</td>
                  <td className="p-3">{o.fecha}</td>
                  <td className="p-3 text-right">{formatoPesos(o.total)}</td>
                  <td className="p-3 text-right">{formatoPesos(o.neto_a_pagar)}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded ${o.estado === 'VIGENTE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {o.estado}
                    </span>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-neutral-400">No hay órdenes que coincidan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
