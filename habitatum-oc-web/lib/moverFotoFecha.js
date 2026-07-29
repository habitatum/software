'use client';

// Mueve una foto de la Bitácora a otra fecha (para el caso en que el equipo
// se le olvidó subir las fotos de un día y las manda después): actualiza
// bitacora_fotos.fecha y recalcula cantidad_fotos tanto del día de origen
// como del día destino, creando el día destino en bitacora_dias si todavía
// no tenía ninguna foto (requiere la política de insert de la migración
// 014). No regenera el resumen narrativo de ningún día (eso sigue
// editándose a mano desde la Bitácora si hace falta).
export async function moverFotoAFecha(supabase, { foto, nuevaFecha, proyectoId }) {
  if (!nuevaFecha || nuevaFecha === foto.fecha) return { error: null };

  const { error: errorUpdateFoto } = await supabase
    .from('bitacora_fotos')
    .update({ fecha: nuevaFecha })
    .eq('id', foto.id);
  if (errorUpdateFoto) return { error: errorUpdateFoto };

  const { count: countOrigen } = await supabase
    .from('bitacora_fotos')
    .select('id', { count: 'exact', head: true })
    .eq('proyecto_id', proyectoId)
    .eq('fecha', foto.fecha);
  await supabase
    .from('bitacora_dias')
    .update({ cantidad_fotos: countOrigen || 0 })
    .eq('proyecto_id', proyectoId)
    .eq('fecha', foto.fecha);

  const { count: countDestino } = await supabase
    .from('bitacora_fotos')
    .select('id', { count: 'exact', head: true })
    .eq('proyecto_id', proyectoId)
    .eq('fecha', nuevaFecha);
  const { error: errorUpsertDestino } = await supabase
    .from('bitacora_dias')
    .upsert(
      { proyecto_id: proyectoId, fecha: nuevaFecha, cantidad_fotos: countDestino || 0, actualizado_en: new Date().toISOString() },
      { onConflict: 'proyecto_id,fecha' }
    );

  return { error: errorUpsertDestino || null };
}
