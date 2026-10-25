'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GastosCajaMenor } from '@/lib/Comprobantes';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function ListadoOrdenesCompra() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [ordenes, setOrdenes] = useState([]);
  // OC incluidas en un corte de cobro cerrado (046): folio → número de corte.
  const [corteDeOC, setCorteDeOC] = useState({});
  const [filtroEstado, setFiltroEstado] = useState('TODAS');
  const [busqueda, setBusqueda] = useState('');
  // 070: retenido, devuelto y descuentos por OC (misma base que retenido_por_devolver_contrato y la Caja).
  const [retenciones, setRetenciones] = useState([]);
const [imputacionCompleta, setImputacionCompleta] = useState({});

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
      const { data: ret } = await supabase.rpc('retenciones_oc_proyecto', { p_proyecto: proyecto.id });
      setRetenciones(ret || []);
      if ((data || []).length > 0) {
        const { data: enCortes } = await supabase
          .from('v_oc_corte_cerrado')
          .select('orden_compra_id, corte_numero')
          .in('orden_compra_id', data.map((o) => o.id));
        const mapaCortes = {};
        (enCortes || []).forEach((r) => { mapaCortes[r.orden_compra_id] = r.corte_numero; });
        setCorteDeOC(mapaCortes);
      }

// Una OC queda "totalmente imputada" cuando CADA uno de sus ítems
// tiene asignaciones al presupuesto cuyo porcentaje suma 100%. Se
// calcula aparte (no viene en la vista) trayendo los ítems de todas
// las OC listadas junto con sus filas de la tabla puente.
const ids = (data || []).map((o) => o.id);
if (ids.length > 0) {
const { data: itemsData } = await supabase
.from('items_oc')
.select('orden_compra_id, items_oc_presupuesto(porcentaje)')
.in('orden_compra_id', ids);
const itemsPorOC = {};
(itemsData || []).forEach((it) => {
if (!itemsPorOC[it.orden_compra_id]) itemsPorOC[it.orden_compra_id] = [];
itemsPorOC[it.orden_compra_id].push(it);
});
const mapaImputacion = {};
ids.forEach((id) => {
const itemsDeEstaOC = itemsPorOC[id] || [];
mapaImputacion[id] = itemsDeEstaOC.length > 0 && itemsDeEstaOC.every((it) => {
const suma = (it.items_oc_presupuesto || []).reduce((acc, a) => acc + Number(a.porcentaje || 0), 0);
return suma >= 99.99;
});
});
setImputacionCompleta(mapaImputacion);
} else {
setImputacionCompleta({});
}
    }
    cargar();
  }, [usuario, proyecto]);

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  const filtradas = ordenes.filter((o) => {
    if (filtroEstado !== 'TODAS' && o.estado !== filtroEstado) return false;
    if (busqueda && !`${o.folio} ${o.proveedores?.nombre ?? ''}`.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  // Los totales del pie de tabla excluyen siempre las OC ANULADAS (sin
  // importar el filtro de estado elegido): una orden anulada no debe sumar
  // en las cifras del proyecto. Sí respetan la búsqueda por folio/proveedor.
  const paraSumar = filtradas.filter((o) => o.estado !== 'ANULADA');
  const totalNetoAPagar = paraSumar.reduce((acc, o) => acc + (Number(o.neto_a_pagar) || 0), 0);
  // Retenciones: solo las OC a la vista (búsqueda y filtro de estado, nunca anuladas). Los descuentos al retenido
  // que no están ligados a una OC se cuentan cuando no hay búsqueda activa.
  const visibles = new Set(paraSumar.map((o) => o.id));
  const filasRet = retenciones.filter((r) => (r.id ? visibles.has(r.id) : !busqueda && filtroEstado !== 'ANULADA'));
  const sumaRet = (lista, k) => lista.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const pendienteDe = (lista) => sumaRet(lista, 'retenido') - sumaRet(lista, 'devuelto') - sumaRet(lista, 'descuento');
  const ret = {
    bruto: sumaRet(filasRet, 'retenido'), devuelto: sumaRet(filasRet, 'devuelto'), descuento: sumaRet(filasRet, 'descuento'),
    pendiente: pendienteDe(filasRet),
    habitatum: pendienteDe(filasRet.filter((r) => !r.paga_cliente)), cliente: pendienteDe(filasRet.filter((r) => r.paga_cliente)),
  };
  const esTodoCosto = proyecto?.modelo_contratacion === 'TODO_COSTO';
  const totalAnticipoPendiente = paraSumar
    .filter((o) => o.tipo_pago === 'ANTICIPO')
    .reduce((acc, o) => acc + (Number(o.saldo_anticipo_por_amortizar) || 0), 0);

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
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

        {/* Caja menor pendiente de legalizar (gastos enviados al bot con "CAJA MENOR"). */}
        <div className="mb-4"><GastosCajaMenor proyecto={proyecto} plegable esAdmin={usuario?.rol === 'admin'} /></div>

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

        <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
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
                    {o.tipo_pago === 'ANTICIPO' && (
                      <span className="ml-2 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded align-middle">ANTICIPO</span>
                    )}
                    {corteDeOC[o.id] && (
                      <span className="ml-2 bg-neutral-200 text-neutral-700 text-[10px] font-semibold px-1.5 py-0.5 rounded align-middle whitespace-nowrap"
                        title="Incluida en un corte de cobro ya presentado: no se puede modificar sin autorización del administrador">
                        🔒 Corte de cobro {corteDeOC[o.id]}
                      </span>
                    )}
{imputacionCompleta[o.id] && (
<span className="ml-2 inline-flex items-center justify-center w-4 h-4 bg-green-100 text-green-700 rounded-full align-middle text-[10px] font-bold" title="Todos los ítems de esta orden están imputados al presupuesto">
✓
</span>
)}
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
            {filtradas.length > 0 && (
              <tfoot>
          <tr className="border-t-2 border-carbon/20 bg-gris-calido/20 font-semibold">
            <td className="p-3" colSpan={4}>Total Neto a Pagar</td>
            <td className="p-3 text-right">{formatoPesos(totalNetoAPagar)}</td>
            <td className="p-3" colSpan={2}></td>
          </tr>
          <tr className="border-t">
            <td className="p-3 pb-1" colSpan={4}>Retenido total (bruto)</td>
            <td className="p-3 pb-1 text-right">{formatoPesos(ret.bruto)}</td>
            <td className="p-3 pb-1" colSpan={2}></td>
          </tr>
          <tr>
            <td className="px-3 py-1" colSpan={4}>(−) Devuelto</td>
            <td className="px-3 py-1 text-right">{formatoPesos(ret.devuelto)}</td>
            <td className="px-3 py-1" colSpan={2}></td>
          </tr>
          {ret.descuento !== 0 && (
            <tr>
              <td className="px-3 py-1" colSpan={4}>(−) Descuentos al retenido</td>
              <td className="px-3 py-1 text-right">{formatoPesos(ret.descuento)}</td>
              <td className="px-3 py-1" colSpan={2}></td>
            </tr>
          )}
          <tr className="font-semibold">
            <td className="p-3 pt-1" colSpan={4}>= Retenido pendiente por devolver</td>
            <td className="p-3 pt-1 text-right">{formatoPesos(ret.pendiente)}</td>
            <td className="p-3 pt-1" colSpan={2}></td>
          </tr>
          {esTodoCosto && ret.cliente !== 0 && (
            <>
              <tr className="text-neutral-600">
                <td className="px-3 py-1 pl-6" colSpan={4}>· Paga HABITATUM (igual a Caja)</td>
                <td className="px-3 py-1 text-right">{formatoPesos(ret.habitatum)}</td>
                <td className="px-3 py-1" colSpan={2}></td>
              </tr>
              <tr className="text-neutral-600">
                <td className="px-3 py-1 pb-3 pl-6" colSpan={4}>· Paga el cliente</td>
                <td className="px-3 py-1 pb-3 text-right">{formatoPesos(ret.cliente)}</td>
                <td className="px-3 py-1 pb-3" colSpan={2}></td>
              </tr>
            </>
          )}
          <tr className="border-t font-semibold">
            <td className="p-3" colSpan={4}>Total Anticipos pendientes por amortizar</td>
            <td className="p-3 text-right">{formatoPesos(totalAnticipoPendiente)}</td>
            <td className="p-3" colSpan={2}></td>
          </tr>
        </tfoot>
            )}
          </table>
        </div>
      </main>
    </div>
  );
}
