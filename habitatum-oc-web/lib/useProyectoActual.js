'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { obtenerProyectoActualId, limpiarProyectoActual } from '@/lib/proyectoActual';

/**
 * Carga el proyecto que el usuario eligió al entrar. Si no ha elegido
 * ninguno (o el guardado ya no existe), lo manda a /proyectos a elegir.
 */
export function useProyectoActual() {
  const [proyecto, setProyecto] = useState(null);
  const [cargando, setCargando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const id = obtenerProyectoActualId();
      if (!id) {
        router.push('/proyectos');
        return;
      }
      const supabase = crearClienteSupabase();
      const { data } = await supabase.from('proyectos').select('*').eq('id', id).single();

      if (!activo) return;

      if (!data) {
        limpiarProyectoActual();
        router.push('/proyectos');
        return;
      }
      setProyecto(data);
      setCargando(false);
    }

    cargar();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { proyecto, cargando };
}
