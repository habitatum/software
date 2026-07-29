'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';
import { exportarBitacora } from '@/lib/exportarBitacora';

function formatoFechaLarga(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Extrae la ruta dentro del bucket 'bitacora-fotos' a partir de la URL
// pública guardada en foto_url, para poder borrar el archivo de Storage.
function rutaStorageDesdeUrl(url) {
  const marcador = '/bitacora-fotos/';
  const idx = url.indexOf(marcador);
  return idx === -1 ? null : url.slice(idx + marcador.length);
}

export default function BitacoraDeObra() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [dias, setDias] = useState([]);
  const [fotosPorDia, setFotosPorDia] = useState({});
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [diasSeleccionados, setDiasSeleccionados] = useState(new Set());
  const [editandoFotoId, setEditandoFotoId] = useState(null);
  const [borradorFoto, setBorradorFoto] = useState({ titulo_ia: '', descripcion_ia: '' });
  const [editandoResumenFecha, setEditandoResumenFecha] = useState(null);
  const [borradorResumen, setBorradorResumen] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [eliminandoFotoId, setEliminandoFotoId] = useState(null);

  const puedeGestionar = usuario?.rol === 'admin' || usuario?.puede_gestionar_bitacora;

  async function cargar() {
    const supabase = crearClienteSupabase();
    const [{ data: diasData }, { data: fotosData }] = await Promise.all([
      supabase.from('bitacora_dias').select('*').eq('proyecto_id', proyecto.id).order('fecha', { ascending: false }),
      supabase.from('bitacora_fotos').select('*').eq('proyecto_id', proyecto.id).order('fecha', { ascending: false }).order('hora'),
    ]);
    setDias(diasData || []);
    setDiasSeleccionados(new Set((diasData || []).map((d) => d.fecha)));
    const agrupadas = {};
    for (const foto of fotosData || []) {
      agrupadas[foto.fecha] = agrupadas[foto.fecha] || [];
      agrupadas[foto.fecha].push(foto);
    }
    setFotosPorDia(agrupadas);
    setCargandoDatos(false);
  }

  useEffect(() => {
    if (!usuario || !proyecto) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, proyecto]);

  if (cargando || !usuario || !proyecto) return null;

  function alternarDia(fecha) {
    setDiasSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(fecha)) next.delete(fecha);
      else next.add(fecha);
      return next;
    });
  }
  function seleccionarTodos() {
    setDiasSeleccionados(new Set(dias.map((d) => d.fecha)));
  }
  function seleccionarNinguno() {
    setDiasSeleccionados(new Set());
  }

  async function descargarWord() {
    setExportando(true);
    try {
      await exportarBitacora({ proyecto, dias, fotosPorDia, fechasSeleccionadas: diasSeleccionados });
    } catch (e) {
      alert('No se pudo generar el Word: ' + e.message);
    } finally {
      setExportando(false);
    }
  }

  function abrirEdicionFoto(foto) {
    setEditandoFotoId(foto.id);
    setBorradorFoto({ titulo_ia: foto.titulo_ia || '', descripcion_ia: foto.descripcion_ia || '' });
  }

  async function guardarFoto(foto) {
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { error } = await supabase
      .from('bitacora_fotos')
      .update({ titulo_ia: borradorFoto.titulo_ia || null, descripcion_ia: borradorFoto.descripcion_ia || null })
      .eq('id', foto.id);
    setGuardando(false);
    if (error) {
      alert('No se pudo guardar: ' + error.message);
      return;
    }
    setEditandoFotoId(null);
    cargar();
  }

  async function eliminarFoto(foto) {
    if (!confirm('¿Eliminar esta foto de la bitácora? Esta acción no se puede deshacer.')) return;
    setEliminandoFotoId(foto.id);
    const supabase = crearClienteSupabase();
    const ruta = rutaStorageDesdeUrl(foto.foto_url);
    if (ruta) await supabase.storage.from('bitacora-fotos').remove([ruta]);
    const { error } = await supabase.from('bitacora_fotos').delete().eq('id', foto.id);
    if (!error) {
      const restantes = (fotosPorDia[foto.fecha] || []).filter((f) => f.id !== foto.id).length;
      await supabase.from('bitacora_dias').update({ cantidad_fotos: restantes }).eq('proyecto_id', proyecto.id).eq('fecha', foto.fecha);
    }
    setEliminandoFotoId(null);
    if (error) {
      alert('No se pudo eliminar: ' + error.message);
      return;
    }
    cargar();
  }

  function abrirEdicionResumen(dia) {
    setEditandoResumenFecha(dia.fecha);
    setBorradorResumen(dia.resumen_texto || '');
  }

  async function guardarResumen(dia) {
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { error } = await supabase.from('bitacora_dias').update({ resumen_texto: borradorResumen || null }).eq('id', dia.id);
    setGuardando(false);
    if (error) {
      alert('No se pudo guardar: ' + error.message);
      return;
    }
    setEditandoResumenFecha(null);
    cargar();
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Bitácora de obra</h1>
            <p className="text-sm text-neutral-500 mt-1">{proyecto.nombre}</p>
          </div>
          {dias.length > 0 && (
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={descargarWord}
                disabled={exportando || diasSeleccionados.size === 0}
                className="bg-neutral-800 text-white px-4 py-2 rounded text-sm hover:bg-neutral-900 disabled:opacity-50 whitespace-nowrap"
              >
                {exportando ? 'Generando...' : `Descargar Word (${diasSeleccionados.size})`}
              </button>
              <div className="flex gap-2 text-xs text-neutral-500">
                <button onClick={seleccionarTodos} className="underline hover:text-neutral-800">Todos</button>
                <button onClick={seleccionarNinguno} className="underline hover:text-neutral-800">Ninguno</button>
              </div>
            </div>
          )}
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
            <div className="flex items-baseline justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={diasSeleccionados.has(dia.fecha)}
                  onChange={() => alternarDia(dia.fecha)}
                  className="rounded border-neutral-300"
                />
                <h2 className="font-medium capitalize">{formatoFechaLarga(dia.fecha)}</h2>
              </label>
              <span className="text-xs text-neutral-400 whitespace-nowrap">{dia.cantidad_fotos} foto{dia.cantidad_fotos === 1 ? '' : 's'}</span>
            </div>

            {editandoResumenFecha === dia.fecha ? (
              <div className="space-y-2">
                <textarea
                  value={borradorResumen}
                  onChange={(e) => setBorradorResumen(e.target.value)}
                  rows={3}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button onClick={() => guardarResumen(dia)} disabled={guardando} className="bg-carbon text-hueso px-3 py-1.5 rounded text-xs disabled:opacity-50">Guardar</button>
                  <button onClick={() => setEditandoResumenFecha(null)} className="text-xs text-neutral-500 px-2">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                {dia.resumen_texto ? (
                  <p className="text-sm text-neutral-700 leading-relaxed">{dia.resumen_texto}</p>
                ) : (
                  <p className="text-sm text-neutral-400 italic">Sin resumen del día.</p>
                )}
                {puedeGestionar && (
                  <button onClick={() => abrirEdicionResumen(dia)} className="text-xs text-neutral-400 hover:text-neutral-700 whitespace-nowrap underline">
                    Editar
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {(fotosPorDia[dia.fecha] || []).map((foto) => (
                <div key={foto.id} className="group">
                  <a href={foto.foto_url} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={foto.foto_url}
                      alt={foto.titulo_ia || foto.descripcion_ia || 'Foto de avance de obra'}
                      className="w-full h-28 object-cover rounded-md border border-neutral-200 group-hover:opacity-90"
                    />
                  </a>

                  {editandoFotoId === foto.id ? (
                    <div className="mt-1 space-y-1">
                      <input
                        value={borradorFoto.titulo_ia}
                        onChange={(e) => setBorradorFoto({ ...borradorFoto, titulo_ia: e.target.value })}
                        placeholder="Título"
                        className="w-full border rounded px-2 py-1 text-xs font-semibold"
                      />
                      <textarea
                        value={borradorFoto.descripcion_ia}
                        onChange={(e) => setBorradorFoto({ ...borradorFoto, descripcion_ia: e.target.value })}
                        placeholder="Detalle"
                        rows={2}
                        className="w-full border rounded px-2 py-1 text-xs"
                      />
                      <div className="flex gap-1.5">
                        <button onClick={() => guardarFoto(foto)} disabled={guardando} className="bg-carbon text-hueso px-2 py-1 rounded text-xs disabled:opacity-50">Guardar</button>
                        <button onClick={() => setEditandoFotoId(null)} className="text-xs text-neutral-500 px-1">Cancelar</button>
                    </div>
                  </div>
                  ) : (
                    <>
                      {(foto.titulo_ia || foto.descripcion_ia) && (
                        <p className="text-xs text-neutral-500 mt-1 leading-snug">
                          {foto.titulo_ia && <span className="font-semibold text-neutral-700">{foto.titulo_ia}</span>}
                          {foto.titulo_ia && foto.descripcion_ia && ' — '}
                          {foto.descripcion_ia}
                        </p>
                      )}
                      {puedeGestionar && (
                        <div className="flex gap-2 mt-1">
                          <button onClick={() => abrirEdicionFoto(foto)} className="text-xs text-neutral-400 hover:text-neutral-700 underline">Editar</button>
                          <button
                            onClick={() => eliminarFoto(foto)}
                            disabled={eliminandoFotoId === foto.id}
                            className="text-xs text-red-400 hover:text-red-700 underline disabled:opacity-50"
                          >
                            {eliminandoFotoId === foto.id ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        </div>
                      )}
                    </>
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
