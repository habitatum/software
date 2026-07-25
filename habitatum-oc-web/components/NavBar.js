'use client';
import Link from 'next/link';
import Image from 'next/image';
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
    <nav className="bg-carbon text-hueso px-6 py-3 flex items-center justify-between border-b border-dorado/30">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/logo-habitatum.png" alt="HABITATUM" width={22} height={34} className="opacity-90" />
          <span className="font-semibold tracking-wide">HABITATUM</span>
        </Link>
        {enlaces.map((e) => (
          <Link key={e.href} href={e.href} className="text-sm text-gris-calido hover:text-dorado transition-colors">
            {e.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-4 text-sm text-gris-calido">
        <span>{usuario?.nombre} · {usuario?.rol}</span>
        <button onClick={salir} className="hover:text-dorado transition-colors">Salir</button>
      </div>
    </nav>
  );
}
