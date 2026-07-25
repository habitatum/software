'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { correoParaLogin } from '@/lib/usuarioInterno';

export default function Login() {
  const [usuarioOCorreo, setUsuarioOCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function iniciarSesion(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    const supabase = crearClienteSupabase();
    const email = correoParaLogin(usuarioOCorreo);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) {
      setError('Correo o contraseña incorrectos.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-carbon px-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 rounded-lg overflow-hidden shadow-2xl">
        {/* Lado de marca, igual a la portada del portafolio */}
        <div className="hidden md:flex flex-col justify-center px-10 py-14 bg-carbon">
          <Image src="/logo-habitatum.png" alt="HABITATUM" width={70} height={110} className="mb-6" />
          <h1 className="text-4xl tracking-wide text-hueso">HABITATUM</h1>
          <div className="w-16 h-px bg-dorado my-3" />
          <p className="font-marca italic text-lg text-gris-calido">Contratos · Proveedores · Órdenes de Compra</p>
        </div>

        {/* Formulario */}
        <div className="bg-hueso px-8 py-14 flex flex-col justify-center">
          <h2 className="text-xl font-semibold mb-1 md:hidden">HABITATUM</h2>
          <form onSubmit={iniciarSesion} className="w-full max-w-sm mx-auto">
            <label className="block text-sm font-medium mb-1">Usuario o correo</label>
            <input
              type="text" required value={usuarioOCorreo} onChange={(e) => setUsuarioOCorreo(e.target.value)}
              className="w-full border border-gris-calido rounded px-3 py-2 mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-dorado"
            />

            <label className="block text-sm font-medium mb-1">Contraseña</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gris-calido rounded px-3 py-2 mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-dorado"
            />

            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

            <button
              type="submit" disabled={cargando}
              className="w-full bg-carbon text-hueso rounded py-2 font-medium hover:bg-dorado hover:text-carbon transition-colors disabled:opacity-50"
            >
              {cargando ? 'Ingresando...' : 'Ingresar'}
            </button>

            <p className="text-xs text-neutral-500 mt-4">
              Los usuarios los crea un administrador desde el módulo de Usuarios. No hay registro público.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
