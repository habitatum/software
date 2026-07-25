'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { crearClienteSupabase } from '@/lib/supabaseClient';

export default function NavBar({ usuario }) {
  const router = useRouter();

  async function salir() {
    const supabase = crearClienteSupabase();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const enlaces = [
    { href: '/dashboard', label: 'Resumen' },
    { href: '/ordenes-compra', label: 'Órdenes de Compra' },
    { href: '/contratos', label: 'Contratos' },
    { href: '/proveedores', label: 'Proveedores' },
  ];
  if (usuario?.rol === 'admin') enlaces.push({ href: '/usuarios', label: 'Usuarios' });

  return (
    <nav className="bg-neutral-900 text-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="font-semibold">HABITATUM</span>
        {enlaces.map((e) => (
          <Link key={e.href} href={e.href} className="text-sm text-neutral-300 hover:text-white">
            {e.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-4 text-sm text-neutral-300">
        <span>{usuario?.nombre} · {usuario?.rol}</span>
        <button onClick={salir} className="hover:text-white">Salir</button>
      </div>
    </nav>
  );
}
