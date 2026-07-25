'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteSupabase } from '@/lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function iniciarSesion(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    const supabase = crearClienteSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) {
      setError('Correo o contraseña incorrectos.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={iniciarSesion} className="bg-white shadow-md rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">HABITATUM</h1>
        <p className="text-sm text-neutral-500 mb-6">Contratos · Proveedores · Órdenes de Compra</p>

        <label className="block text-sm font-medium mb-1">Correo</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />

        <label className="block text-sm font-medium mb-1">Contraseña</label>
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <button
          type="submit" disabled={cargando}
          className="w-full bg-neutral-900 text-white rounded py-2 font-medium disabled:opacity-50"
        >
          {cargando ? 'Ingresando...' : 'Ingresar'}
        </button>

        <p className="text-xs text-neutral-400 mt-4">
          Los usuarios los crea un administrador desde el módulo de Usuarios. No hay registro público.
        </p>
      </form>
    </div>
  );
}
