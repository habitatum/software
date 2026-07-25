'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { guardarProyectoActualId } from '@/lib/proyectoActual';

const VACIO = { nombre: '', codigo: '', cliente: '' };

export default function SeleccionarProyecto() {
  const { usuario, cargando } = useUsuarioActual();
  const router = useRouter();
  const [proyectos, setProyectos] = useState([]);
  const [cargandoProyectos, setCargandoProyectos] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('proyectos').select('*').eq('estado', 'activo').order('nombre');
    setProyectos(data || []);
    setCargandoProyectos(false);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  function elegir(id) {
    guardarProyectoActualId(id);
    router.push('/dashboard');
  }

  async function crearProyecto(e) {
    e.preventDefault();
    setError('');
    if (!form.nombre.trim() || !form.codigo.trim()) {
      setError('Nombre y código son obligatorios.');
      return;
    }
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { data, error: err } = await supabase
      .from('proyectos')
      .insert({
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim().toUpperCase().replace(/\s+/g, '-'),
        cliente: form.cliente.trim() || null,
      })
      .select()
      .single();
    setGuardando(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'Ya existe un proyecto con ese código.' : err.message);
      return;
    }
    setForm(VACIO);
    setMostrarForm(false);
    elegir(data.id);
  }

  if (cargando || !usuario) return null;

  return (
    <div className="min-h-screen bg-carbon">
      <div className="max-w-3xl mx-auto py-14 px-4">
        <div className="flex flex-col items-center mb-10">
          <Image src="/logo-habitatum.png" alt="HABITATUM" width={50} height={78} className="mb-4" />
          <h1 className="text-2xl text-hueso tracking-wide">Selecciona un proyecto</h1>
          <p className="text-gris-calido text-sm mt-1">{usuario.nombre}</p>
        </div>

        {!cargandoProyectos && (
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            {proyectos.map((p) => (
              <button
                key={p.id}
                onClick={() => elegir(p.id)}
                className="bg-hueso rounded-lg p-5 text-left border border-transparent hover:border-dorado transition-colors"
              >
                <p className="font-semibold text-lg">{p.nombre}</p>
                <p className="text-xs text-neutral-500 mt-1">Código: {p.codigo}</p>
                {p.cliente && <p className="text-sm text-neutral-600 mt-2">{p.cliente}</p>}
              </button>
            ))}
            {proyectos.length === 0 && (
              <p className="text-gris-calido col-span-2 text-center py-8">Aún no hay proyectos creados.</p>
            )}
          </div>
        )}

        {usuario.rol === 'admin' && (
          <div className="bg-hueso rounded-lg p-5">
            {!mostrarForm ? (
              <button onClick={() => setMostrarForm(true)} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
                + Crear proyecto
              </button>
            ) : (
              <form onSubmit={crearProyecto} className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <input
                    required
                    placeholder="Nombre del proyecto"
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    required
                    placeholder="Código (ej. DYABOO)"
                    value={form.codigo}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Cliente (opcional)"
                    value={form.cliente}
                    onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                    className="border rounded px-3 py-2 text-sm sm:col-span-2"
                  />
                </div>
                {error && <p className="text-red-600 text-sm">{error}</p>}
                <div className="flex gap-2">
                  <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
                    {guardando ? 'Creando...' : 'Crear y entrar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMostrarForm(false); setError(''); }}
                    className="px-4 py-2 rounded text-sm border"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
