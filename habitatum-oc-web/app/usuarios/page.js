'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';

export default function Usuarios() {
  const { usuario, cargando } = useUsuarioActual(['admin']);
  const [usuarios, setUsuarios] = useState([]);
  const [invitacion, setInvitacion] = useState({ email: '', nombre: '', rol: 'operativo' });
  const [mensaje, setMensaje] = useState('');

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('usuarios').select('*').order('nombre');
    setUsuarios(data || []);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  async function invitar(e) {
    e.preventDefault();
    setMensaje('');
    // La invitación real (envío de correo con acceso) se hace vía Supabase Admin API
    // desde una función de servidor — ver /app/api/usuarios/invitar/route.js (Fase 2).
    const res = await fetch('/api/usuarios/invitar', {
      method: 'POST',
      body: JSON.stringify(invitacion),
    });
    if (res.ok) {
      setMensaje('Invitación enviada. El usuario recibirá un correo para crear su contraseña.');
      setInvitacion({ email: '', nombre: '', rol: 'operativo' });
      cargar();
    } else {
      setMensaje('No se pudo enviar la invitación. Revisa el correo e inténtalo de nuevo.');
    }
  }

  async function cambiarRol(id, rol) {
    const supabase = crearClienteSupabase();
    await supabase.from('usuarios').update({ rol }).eq('id', id);
    cargar();
  }
  async function alternarActivo(id, activo) {
    const supabase = crearClienteSupabase();
    await supabase.from('usuarios').update({ activo: !activo }).eq('id', id);
    cargar();
  }

  if (cargando || !usuario) return null;

  return (
    <div>
      <NavBar usuario={usuario} />
      <main className="p-8 max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Usuarios</h1>

        <form onSubmit={invitar} className="bg-white border rounded-lg p-5 grid grid-cols-4 gap-3 items-end">
          <div className="col-span-2">
            <label className="block text-xs mb-1">Correo</label>
            <input required type="email" value={invitacion.email} onChange={(e) => setInvitacion({ ...invitacion, email: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs mb-1">Nombre</label>
            <input required value={invitacion.nombre} onChange={(e) => setInvitacion({ ...invitacion, nombre: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs mb-1">Rol</label>
            <select value={invitacion.rol} onChange={(e) => setInvitacion({ ...invitacion, rol: e.target.value })} className="border rounded px-3 py-2 text-sm w-full">
              <option value="admin">Admin</option>
              <option value="operativo">Operativo</option>
              <option value="lectura">Lectura</option>
            </select>
          </div>
          <button className="bg-neutral-900 text-white px-4 py-2 rounded text-sm col-span-4">Invitar usuario</button>
        </form>
        {mensaje && <p className="text-sm text-neutral-600">{mensaje}</p>}

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-100 text-left"><tr><th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Rol</th><th className="p-3">Estado</th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3">{u.nombre}</td>
                  <td className="p-3">{u.email}</td>
                  <td className="p-3">
                    <select value={u.rol} onChange={(e) => cambiarRol(u.id, e.target.value)} className="border rounded px-2 py-1 text-xs">
                      <option value="admin">Admin</option>
                      <option value="operativo">Operativo</option>
                      <option value="lectura">Lectura</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <button onClick={() => alternarActivo(u.id, u.activo)} className={`text-xs px-2 py-1 rounded ${u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
