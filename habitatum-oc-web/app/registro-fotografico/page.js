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

// Archivo cronológico simple de todas las fotos recibidas por Telegram: a
// diferencia de la Bitácora (que resalta el relato del día), aquí lo
// importante es el archivo foto por foto, agrupado por fecha para que sea
// fácil ubicar una imagen puntual.
export default function RegistroFotografico() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [gruposPorFecha, setGruposPorFecha] = useState([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargar() {
      const supabase = crearClienteSupabase();
      const { data } = await supabase
        .from('bitacora_fotos')
        .select('*')
        .eq('proyecto_id', proyecto.id)
        .order('fecha', { ascending: false })
        .order('hora', { ascending: false });

      const agrupadas = {};
      for (const foto of data || []) {
        agrupadas[foto.fecha] = agrupadas[foto.fecha] || [];
        agrupadas[foto.fecha].push(foto);
      }
      setGruposPorFecha(Object.entries(agrupadas).sort((a, b) => (a[0] < b[0] ? 1 : -1)));
      setCargandoDatos(false);
    }
    cargar();
  }, [usuario, proyecto]);

  if (cargando || !usuario || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Registro fotográfico</h1>
          <p className="text-sm text-neutral-500 mt-1">{proyecto.nombre}</p>
        </div>

        {!proyecto.telegram_chat_id && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-4 text-sm">
            Este proyecto todavía no tiene un grupo de Telegram vinculado. Ve a <strong>Proyectos → Editar</strong>{' '}
            para vincularlo y que las fotos que el equipo envíe ahí se guarden aquí automáticamente.
          </div>
        )}

        {!cargandoDatos && gruposPorFecha.length === 0 && proyecto.telegram_chat_id && (
          <p className="text-neutral-400 text-center py-10">Aún no han llegado fotos al grupo de este proyecto.</p>
        )}

        {gruposPorFecha.map(([fecha, fotos]) => (
          <div key={fecha} className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
            <h2 className="font-medium capitalize text-sm text-neutral-700">{formatoFechaLarga(fecha)}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {fotos.map((foto) => (
                <a key={foto.id} href={foto.foto_url} target="_blank" rel="noreferrer" className="block group">
                  <img
                    src={foto.foto_url}
                    alt={foto.titulo_ia || foto.descripcion_ia || 'Foto de avance de obra'}
                    className="w-full h-28 object-cover rounded-md border border-neutral-200 group-hover:opacity-90"
                  />
                  <p className="text-xs text-neutral-400 mt-1">{foto.hora?.slice(0, 5)}</p>
                  {(foto.titulo_ia || foto.descripcion_ia) && (
                    <p className="text-xs text-neutral-500 leading-snug">
                      {foto.titulo_ia && <span className="font-semibold text-neutral-700">{foto.titulo_ia}</span>}
                      {foto.titulo_ia && foto.descripcion_ia && ' — '}
                      {foto.descripcion_ia}
                    </p>
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
