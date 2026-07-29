'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';
import { moverFotoAFecha } from '@/lib/moverFotoFecha';

function formatoFechaLarga(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function rutaStorageDesdeUrl(url) {
  const marcador = '/bitacora-fotos/';
  const idx = url.indexOf(marcador);
  return idx === -1 ? null : url.slice(idx + marcador.length);
}

// Archivo cronológico simple de todas las fotos recibidas por Telegram: a
// diferencia de la Bitácora (que resalta el relato del día con título y
// detalle de cada foto), aquí solo importa el archivo foto por foto,
// agrupado por fecha, sin texto — para que sea fácil ubicar una imagen
// puntual de un vistazo.
export default function RegistroFotografico() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [gruposPorFecha, setGruposPorFecha] = useState([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [eliminandoFotoId, setEliminandoFotoId] = useState(null);
  const [editandoFechaFotoId, setEditandoFechaFotoId] = useState(null);
  const [borradorFecha, setBorradorFecha] = useState('');
  const [moviendoFoto, setMoviendoFoto] = useState(false);

  const puedeGestionar = usuario?.rol === 'admin' || usuario?.puede_gestionar_bitacora;

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

  useEffect(() => {
    if (!usuario || !proyecto) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, proyecto]);

  if (cargando || !usuario || !proyecto) return null;

  async function eliminarFoto(foto) {
    if (!confirm('¿Eliminar esta foto? Esta acción no se puede deshacer.')) return;
    setEliminandoFotoId(foto.id);
    const supabase = crearClienteSupabase();
    const ruta = rutaStorageDesdeUrl(foto.foto_url);
    if (ruta) await supabase.storage.from('bitacora-fotos').remove([ruta]);
    const { error } = await supabase.from('bitacora_fotos').delete().eq('id', foto.id);
    if (!error) {
      const grupo = gruposPorFecha.find(([fecha]) => fecha === foto.fecha);
      const restantes = grupo ? grupo[1].filter((f) => f.id !== foto.id).length : 0;
      await supabase.from('bitacora_dias').update({ cantidad_fotos: restantes }).eq('proyecto_id', proyecto.id).eq('fecha', foto.fecha);
    }
    setEliminandoFotoId(null);
    if (error) {
      alert('No se pudo eliminar: ' + error.message);
      return;
    }
    cargar();
  }

  function abrirEdicionFecha(foto) {
    setEditandoFechaFotoId(foto.id);
    setBorradorFecha(foto.fecha);
  }

  async function guardarFecha(foto) {
    if (!borradorFecha) return;
    setMoviendoFoto(true);
    const supabase = crearClienteSupabase();
    const { error } = await moverFotoAFecha(supabase, { foto, nuevaFecha: borradorFecha, proyectoId: proyecto.id });
    setMoviendoFoto(false);
    if (error) {
      alert('No se pudo cambiar la fecha: ' + error.message);
      return;
    }
    setEditandoFechaFotoId(null);
    cargar();
  }

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
                <div key={foto.id} className="group">
                  <a href={foto.foto_url} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={foto.foto_url}
                      alt="Foto de avance de obra"
                      className="w-full h-28 object-cover rounded-md border border-neutral-200 group-hover:opacity-90"
                    />
                  </a>
                  <p className="text-xs text-neutral-400 mt-1">{foto.hora?.slice(0, 5)}</p>

                  {editandoFechaFotoId === foto.id ? (
                    <div className="mt-1 space-y-1">
                      <input
                        type="date"
                        value={borradorFecha}
                        onChange={(e) => setBorradorFecha(e.target.value)}
                        className="w-full border rounded px-2 py-1 text-xs"
                      />
                      <div className="flex gap-1.5">
                        <button onClick={() => guardarFecha(foto)} disabled={moviendoFoto} className="bg-carbon text-hueso px-2 py-1 rounded text-xs disabled:opacity-50">
                          {moviendoFoto ? 'Moviendo...' : 'Mover'}
                        </button>
                        <button onClick={() => setEditandoFechaFotoId(null)} className="text-xs text-neutral-500 px-1">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    puedeGestionar && (
                      <div className="flex gap-2 mt-1 flex-wrap">
                        <button onClick={() => abrirEdicionFecha(foto)} className="text-xs text-neutral-400 hover:text-neutral-700 underline">Cambiar día</button>
                        <button
                          onClick={() => eliminarFoto(foto)}
                          disabled={eliminandoFotoId === foto.id}
                          className="text-xs text-red-400 hover:text-red-700 underline disabled:opacity-50"
                        >
                          {eliminandoFotoId === foto.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
