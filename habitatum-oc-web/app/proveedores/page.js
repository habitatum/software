'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';

const VACIO = { nombre: '', nit: '', banco: '', tipo_cuenta: '', numero_cuenta: '', representante_legal: '', telefono: '' };

export default function Proveedores() {
  const { usuario, cargando } = useUsuarioActual();
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [mostrarForm, setMostrarForm] = useState(false);

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('proveedores').select('*').order('nombre');
    setProveedores(data || []);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  async function guardar(e) {
    e.preventDefault();
    const supabase = crearClienteSupabase();
    await supabase.from('proveedores').insert(form);
    setForm(VACIO);
    setMostrarForm(false);
    cargar();
  }

  if (cargando || !usuario) return null;

  return (
    <div>
      <NavBar usuario={usuario} />
      <main className="p-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Proveedores</h1>
          {usuario.rol !== 'lectura' && (
            <button onClick={() => setMostrarForm(!mostrarForm)} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              {mostrarForm ? 'Cancelar' : '+ Nuevo proveedor'}
            </button>
          )}
        </div>

        {mostrarForm && (
          <form onSubmit={guardar} className="bg-white border rounded-lg p-5 grid grid-cols-2 gap-3 mb-6">
            <input required placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="NIT" value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Representante legal" value={form.representante_legal} onChange={(e) => setForm({ ...form, representante_legal: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Teléfono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Banco" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Tipo de cuenta" value={form.tipo_cuenta} onChange={(e) => setForm({ ...form, tipo_cuenta: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Número de cuenta" value={form.numero_cuenta} onChange={(e) => setForm({ ...form, numero_cuenta: e.target.value })} className="border rounded px-3 py-2 text-sm col-span-2" />
            <p className="col-span-2 text-xs text-neutral-400 -mt-1">
              El representante legal y teléfono se usan al generar el PDF de un Contrato con este proveedor como Contratista/Proveedor.
            </p>
            <button className="bg-carbon text-hueso px-4 py-2 rounded text-sm col-span-2">Guardar</button>
          </form>
        )}

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left">
              <tr><th className="p-3">Nombre</th><th className="p-3">NIT</th><th className="p-3">Representante legal</th><th className="p-3">Banco</th><th className="p-3">Cuenta</th></tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.nombre}</td><td className="p-3">{p.nit}</td>
                  <td className="p-3">{p.representante_legal}</td>
                  <td className="p-3">{p.banco}</td><td className="p-3">{p.tipo_cuenta} {p.numero_cuenta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
