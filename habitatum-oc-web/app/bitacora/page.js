'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';

function formatoFechaLarga(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function BitacoraDeObra() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [dias, setDias] = useState([]);
  const [fotosPorDia, setFotosPorDia] = useState({});
  const [cargandoDatos, setCargandoDatos] = useState(true);

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargar() {
      const supabase = crearClienteSupabase();
      const [{ data: diasData }, { data: fotosData }] = await Promise.all([
        supabase.from('bitacora_dias').select('*').eq('proyecto_id', proyecto.id).order('fecha', { ascending: false }),
        supabase.from('bitacora_fotos').select('*').eq('proyecto_id', proyecto.id).order('fecha', { ascending: false }).order('hora'),
      ]);
      setDias(diasData || []);
      const agrupadas = {};
      for (const foto of fotosData || []) {
        agrupadas[foto.fecha] = agrupadas[foto.fecha] || [];
        agrupadas[foto.fecha].push(foto);
      }
      setFotosPorDia(agrupadas);
      setCargandoDatos(false);
    }
    cargar();
  }, [usuario, proyecto]);

  if (cargando || !usuario || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Bitácora de obra</h1>
          <p className="text-sm text-neutral-500 mt-1">{proyecto.nombre}</p>
        </div>

        {!proyecto.telegram_chat_id && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-4 text-sm">
            Este proyecto todavía no tiene un grupo de Telegram vinculado. Ve a <strong>Proyectos → Editar</strong>{' '}
            para vincularlo y que las fotos que el equipo envíe ahí empiecen a llenar esta bitácora automáticamente.
          </div>
        )}

        {!cargandoDatos && dias.length === 0 && proyecto.telegram_chat_id && (
          <p className="text-neutral-400 text-center py-10">Aún no han llegado fotos al grupo de este proyecto.</p>
        )}

        {dias.map((dia) => (
          <div key={dia.fecha} className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium capitalize">{formatoFechaLarga(dia.fecha)}</h2>
              <span className="text-xs text-neutral-400">{dia.cantidad_fotos} foto{dia.cantidad_fotos === 1 ? '' : 's'}</span>
            </div>
            {dia.resumen_texto && <p className="text-sm text-neutral-700 leading-relaxed">{dia.resumen_texto}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {(fotosPorDia[dia.fecha] || []).map((foto) => (
                <a key={foto.id} href={foto.foto_url} target="_blank" rel="noreferrer" className="block group">
                  <img
                    src={foto.foto_url}
                    alt={foto.descripcion_ia || 'Foto de avance de obra'}
                    className="w-full h-28 object-cover rounded-md border border-neutral-200 group-hover:opacity-90"
                  />
                  {foto.descripcion_ia && (
                    <p className="text-xs text-neutral-500 mt-1 leading-snug">{foto.descripcion_ia}</p>
                  )}
                </a>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
