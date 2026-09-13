'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { crearClienteSupabase } from '@/lib/supabaseClient';

export default function NavBar({ usuario, proyecto }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  async function salir() {
    const supabase = crearClienteSupabase();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const enlaces = [
    { href: '/dashboard', label: 'Resumen' },
    { href: '/ordenes-compra', label: 'Órdenes de Compra' },
    { href: '/contratos', label: 'Contratos' },
    { href: '/presupuesto', label: 'Presupuesto' },
    { href: '/bitacora', label: 'Bitácora' },
    { href: '/registro-fotografico', label: 'Registro Fotográfico' },
    { href: '/proveedores', label: 'Proveedores' },
  ];
  if (usuario?.rol === 'admin') enlaces.push({ href: '/usuarios', label: 'Usuarios' });

  return (
    <nav className="bg-carbon text-hueso border-b border-dorado/30 relative z-50">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 shrink-0" onClick={() => setAbierto(false)}>
          <Image src="/logo-habitatum.png" alt="HABITATUM" width={22} height={34} className="opacity-90" />
          <span className="font-semibold tracking-wide">HABITATUM</span>
        </Link>

        <div className="hidden lg:flex items-center gap-6 flex-1 min-w-0 overflow-x-auto">
          {enlaces.map((e) => (
            <Link key={e.href} href={e.href} className="text-sm text-gris-calido hover:text-dorado transition-colors whitespace-nowrap">
              {e.label}
            </Link>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-4 text-sm text-gris-calido shrink-0">
          {proyecto && (
            <Link
              href="/proyectos"
              className="flex items-center gap-2 border border-dorado/40 rounded px-3 py-1 hover:border-dorado transition-colors whitespace-nowrap"
            >
              <span className="text-dorado">●</span> {proyecto.nombre}
              <span className="text-xs text-gris-calido/70">Cambiar</span>
            </Link>
          )}
          <span className="whitespace-nowrap">{usuario?.nombre} · {usuario?.rol}</span>
          <button onClick={salir} className="hover:text-dorado transition-colors">Salir</button>
        </div>

        <button
          onClick={() => setAbierto(!abierto)}
          className="lg:hidden p-2 -mr-2 text-hueso"
          aria-label="Abrir menú"
        >
          {abierto ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {abierto && (
        <div className="lg:hidden border-t border-dorado/30 bg-carbon px-4 py-3 space-y-3 max-h-[calc(100vh-56px)] overflow-y-auto">
          {proyecto && (
            <Link
              href="/proyectos"
              onClick={() => setAbierto(false)}
              className="flex items-center gap-2 border border-dorado/40 rounded px-3 py-2 text-sm text-gris-calido"
            >
              <span className="text-dorado">●</span> {proyecto.nombre}
              <span className="text-xs text-gris-calido/70 ml-auto">Cambiar</span>
            </Link>
          )}
          <div className="flex flex-col">
            {enlaces.map((e) => (
              <Link
                key={e.href}
                href={e.href}
                onClick={() => setAbierto(false)}
                className="text-sm text-gris-calido hover:text-dorado transition-colors py-2.5 border-b border-dorado/10 last:border-0"
              >
                {e.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 text-sm text-gris-calido">
            <span>{usuario?.nombre} · {usuario?.rol}</span>
            <button onClick={salir} className="text-dorado">Salir</button>
          </div>
        </div>
      )}
    </nav>
  );
}
