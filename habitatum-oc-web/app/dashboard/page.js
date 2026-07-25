'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

export default function Dashboard() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [indicadores, setIndicadores] = useState(null);

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargarIndicadores() {
      const supabase = crearClienteSupabase();
      const { data: oc } = await supabase
        .from('v_ordenes_compra_calculadas')
        .select('*')
        .eq('proyecto_id', proyecto.id);
      const { count: contratosActivos } = await supabase
        .from('contratos')
        .select('*', { count: 'exact', head: true })
        .eq('proyecto_id', proyecto.id);

      const vigentes = (oc || []).filter((o) => o.estado === 'VIGENTE');
      const esteMes = vigentes.filter((o) => new Date(o.fecha).getMonth() === new Date().getMonth());

      setIndicadores({
        ocVigentes: vigentes.length,
        totalMes: esteMes.reduce((acc, o) => acc + Number(o.subtotal || 0), 0),
        saldoPendiente: vigentes.reduce((acc, o) => acc + (Number(o.subtotal || 0) - Number(o.pagado || 0)), 0),
        contratosActivos: contratosActivos || 0,
      });
    }
    cargarIndicadores();
  }, [usuario, proyecto]);

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Resumen</h1>
        <p className="text-sm text-neutral-500 mb-6">{proyecto.nombre}</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Tarjeta titulo="OC vigentes" valor={indicadores?.ocVigentes ?? '—'} />
          <Tarjeta titulo="Emitido este mes" valor={indicadores ? formatoPesos(indicadores.totalMes) : '—'} />
          <Tarjeta titulo="Saldo pendiente" valor={indicadores ? formatoPesos(indicadores.saldoPendiente) : '—'} />
          <Tarjeta titulo="Contratos activos" valor={indicadores?.contratosActivos ?? '—'} />
        </div>

        <div className="flex gap-3">
          <Link href="/ordenes-compra/nueva" className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
            + Nueva Orden de Compra
          </Link>
          <Link href="/contratos" className="border px-4 py-2 rounded text-sm">
            Ver Contratos
          </Link>
        </div>
      </main>
    </div>
  );
}

function Tarjeta({ titulo, valor }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 border">
      <p className="text-xs text-neutral-500 mb-1">{titulo}</p>
      <p className="text-xl font-semibold">{valor}</p>
    </div>
  );
}
