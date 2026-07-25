'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteSupabase } from '@/lib/supabaseClient';

/**
 * Carga el usuario autenticado + su perfil (rol) de la tabla `usuarios`.
 * Redirige a /login si no hay sesión. Si `rolesPermitidos` se pasa y el
 * rol del usuario no está en la lista, redirige a /dashboard.
 */
export function useUsuarioActual(rolesPermitidos = null) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = crearClienteSupabase();
    let activo = true;

    async function cargar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (!activo) return;

      if (!perfil || !perfil.activo) {
        await supabase.auth.signOut();
        router.push('/login');
        return;
      }
      if (rolesPermitidos && !rolesPermitidos.includes(perfil.rol)) {
        router.push('/dashboard');
        return;
      }
      setUsuario(perfil);
      setCargando(false);
    }

    cargar();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { usuario, cargando };
}
