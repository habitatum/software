'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteSupabase } from '@/lib/supabaseClient';

export default function Inicio() {
  const router = useRouter();
  useEffect(() => {
    async function verificar() {
      const supabase = crearClienteSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      router.push(session ? '/proyectos' : '/login');
    }
    verificar();
  }, []); // eslint-disable-line
  return null;
}
