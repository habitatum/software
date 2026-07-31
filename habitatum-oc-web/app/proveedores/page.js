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
  const [editandoId, setEditandoId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState(null);
  const [error, setError] = useState('');

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('proveedores').select('*').order('nombre');
    setProveedores(data || []);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  function abrirCreacion() {
    setForm(VACIO);
    setEditandoId(null);
    setError('');
    setMostrarForm(true);
  }

  // Editar: exclusivo de Admin. Precarga el mismo formulario de arriba con
  // los datos del proveedor elegido.
  function abrirEdicion(p) {
    setForm({
      nombre: p.nombre || '',
      nit: p.nit || '',
      banco: p.banco || '',
      tipo_cuenta: p.tipo_cuenta || '',
      numero_cuenta: p.numero_cuenta || '',
      representante_legal: p.representante_legal || '',
      telefono: p.telefono || '',
    });
    setEditandoId(p.id);
    setError('');
    setMostrarForm(true);
  }

  function cancelar() {
    setMostrarForm(false);
    setEditandoId(null);
    setForm(VACIO);
    setError('');
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { error: err } = editandoId
      ? await supabase.from('proveedores').update(form).eq('id', editandoId)
      : await supabase.from('proveedores').insert(form);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setForm(VACIO);
    setEditandoId(null);
    setMostrarForm(false);
    cargar();
  }

  // Eliminar: borrado permanente, exclusivo de Admin. Si el proveedor tiene
  // Contratos u Órdenes de Compra asociadas, la base de datos rechaza el
  // borrado (llave foránea) para no perder ese historial — se traduce ese
  // error a un mensaje claro en vez de mostrar el error crudo de Postgres.
  async function eliminarProveedor(p) {
    if (!window.confirm(`¿Eliminar el proveedor "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
    setEliminandoId(p.id);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('proveedores').delete().eq('id', p.id);
    setEliminandoId(null);
    if (err) {
      if (err.code === '23503' || /foreign key|violates/i.test(err.message)) {
        window.alert(`No se puede eliminar "${p.nombre}": tiene Contratos u Órdenes de Compra asociadas y se perdería ese historial. Puedes editarlo, pero no eliminarlo mientras tenga movimientos.`);
      } else {
        window.alert(err.message);
      }
      return;
    }
    cargar();
  }

  if (cargando || !usuario) return null;

  const esAdmin = usuario.rol === 'admin';

  return (
    <div>
      <NavBar usuario={usuario} />
      <main className="p-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Proveedores</h1>
          {usuario.rol !== 'lectura' && (
            <button onClick={() => (mostrarForm ? cancelar() : abrirCreacion())} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              {mostrarForm ? 'Cancelar' : '+ Nuevo proveedor'}
            </button>
          )}
        </div>

        {mostrarForm && (
          <form onSubmit={guardar} className="bg-white border rounded-lg p-5 grid grid-cols-2 gap-3 mb-6">
            <p className="col-span-2 text-xs text-neutral-500 -mb-1">
              {editandoId ? 'Editando proveedor' : 'Nuevo proveedor'}
            </p>
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
            {error && <p className="col-span-2 text-red-600 text-sm">{error}</p>}
            <div className="col-span-2 flex gap-2">
              <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
                {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Guardar'}
              </button>
              <button type="button" onClick={cancelar} className="px-4 py-2 rounded text-sm border">Cancelar</button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left">
              <tr>
                <th className="p-3">Nombre</th><th className="p-3">NIT</th><th className="p-3">Representante legal</th><th className="p-3">Banco</th><th className="p-3">Cuenta</th>
                {esAdmin && <th className="p-3">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.nombre}</td><td className="p-3">{p.nit}</td>
                  <td className="p-3">{p.representante_legal}</td>
                  <td className="p-3">{p.banco}</td><td className="p-3">{p.tipo_cuenta} {p.numero_cuenta}</td>
                  {esAdmin && (
                    <td className="p-3">
                      <div className="flex gap-3">
                        <button onClick={() => abrirEdicion(p)} className="text-blue-700 hover:underline text-xs">Editar</button>
                        <button
                          onClick={() => eliminarProveedor(p)}
                          disabled={eliminandoId === p.id}
                          className="text-red-600 hover:underline text-xs disabled:opacity-50"
                        >
                          {eliminandoId === p.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
