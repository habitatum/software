'use client';
import { Fragment, useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';

export default function Usuarios() {
  const { usuario, cargando } = useUsuarioActual(['admin']);
  const [usuarios, setUsuarios] = useState([]);
  const [modo, setModo] = useState('correo'); // 'correo' | 'usuario'
  const [invitacion, setInvitacion] = useState({ email: '', usuario: '', nombre: '', rol: 'operativo' });
  const [mensaje, setMensaje] = useState('');
  const [credencialCreada, setCredencialCreada] = useState(null); // { usuario, contrasenaTemporal }
  const [reseteando, setReseteando] = useState(null); // id del usuario en proceso
  const [filaResetAbierta, setFilaResetAbierta] = useState(null); // id del usuario con el campo abierto
  const [contrasenaManual, setContrasenaManual] = useState('');

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('usuarios').select('*').order('nombre');
    setUsuarios(data || []);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  async function invitar(e) {
    e.preventDefault();
    setMensaje('');
    setCredencialCreada(null);

    const supabase = crearClienteSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch('/api/usuarios/invitar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ modo, ...invitacion }),
    });
    const data = await res.json();

    if (res.ok) {
      if (modo === 'usuario') {
        setCredencialCreada({ usuario: data.usuario, contrasenaTemporal: data.contrasenaTemporal });
        setMensaje('Usuario creado. Copia la contraseña de abajo y entrégasela directamente — no se volverá a mostrar.');
      } else {
        setMensaje('Invitación enviada. El usuario recibirá un correo para crear su contraseña.');
      }
      setInvitacion({ email: '', usuario: '', nombre: '', rol: 'operativo' });
      cargar();
    } else {
      setMensaje(data.error || 'No se pudo crear el usuario. Revisa los datos e inténtalo de nuevo.');
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
  async function alternarPermisoBitacora(id, actual) {
    const supabase = crearClienteSupabase();
    await supabase.from('usuarios').update({ puede_gestionar_bitacora: !actual }).eq('id', id);
    cargar();
  }

  function abrirReset(u) {
    setFilaResetAbierta(filaResetAbierta === u.id ? null : u.id);
    setContrasenaManual('');
    setMensaje('');
    setCredencialCreada(null);
  }

  async function resetearPassword(u, contrasenaElegida) {
    if (contrasenaElegida && contrasenaElegida.length < 6) {
      setMensaje('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (!confirm(`¿Restablecer la contraseña de ${u.nombre}? La contraseña actual dejará de funcionar.`)) return;
    setReseteando(u.id);
    setMensaje('');
    setCredencialCreada(null);

    const supabase = crearClienteSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch('/api/usuarios/resetear-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ id: u.id, nuevaContrasena: contrasenaElegida || undefined }),
    });
    const data = await res.json();
    setReseteando(null);
    setFilaResetAbierta(null);
    setContrasenaManual('');

    if (res.ok) {
      setCredencialCreada({ usuario: u.usuario || u.email, contrasenaTemporal: data.contrasenaTemporal });
      setMensaje(`Contraseña de ${u.nombre} restablecida. Copia la de abajo y entrégasela directamente — no se volverá a mostrar.`);
    } else {
      setMensaje(data.error || 'No se pudo restablecer la contraseña.');
    }
  }

  if (cargando || !usuario) return null;

  return (
    <div>
      <NavBar usuario={usuario} />
      <main className="p-8 max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Usuarios</h1>

        <div className="bg-white border rounded-lg p-5 space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setModo('correo'); setCredencialCreada(null); setMensaje(''); }}
              className={`text-sm px-3 py-1.5 rounded ${modo === 'correo' ? 'bg-carbon text-hueso' : 'bg-gris-calido/30'}`}
            >
              Tiene correo
            </button>
            <button
              type="button"
              onClick={() => { setModo('usuario'); setCredencialCreada(null); setMensaje(''); }}
              className={`text-sm px-3 py-1.5 rounded ${modo === 'usuario' ? 'bg-carbon text-hueso' : 'bg-gris-calido/30'}`}
            >
              Sin correo (usuario interno)
            </button>
          </div>

          <form onSubmit={invitar} className="grid grid-cols-4 gap-3 items-end">
            {modo === 'correo' ? (
              <div className="col-span-2">
                <label className="block text-xs mb-1">Correo</label>
                <input required type="email" value={invitacion.email} onChange={(e) => setInvitacion({ ...invitacion, email: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            ) : (
              <div className="col-span-2">
                <label className="block text-xs mb-1">Usuario (sin espacios, ej. residente1)</label>
                <input required value={invitacion.usuario} onChange={(e) => setInvitacion({ ...invitacion, usuario: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            )}
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
            <button className="bg-carbon text-hueso px-4 py-2 rounded text-sm col-span-4">
              {modo === 'correo' ? 'Invitar usuario' : 'Crear usuario'}
            </button>
          </form>

          {mensaje && <p className="text-sm text-neutral-600">{mensaje}</p>}

          {credencialCreada && (
            <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm space-y-1">
              <p><strong>Usuario:</strong> {credencialCreada.usuario}</p>
              <p><strong>Contraseña temporal:</strong> <span className="font-mono">{credencialCreada.contrasenaTemporal}</span></p>
              <p className="text-neutral-500">Entrégasela directamente a la persona. No queda guardada en ningún otro lugar.</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left"><tr><th className="p-3">Nombre</th><th className="p-3">Correo / Usuario</th><th className="p-3">Rol</th><th className="p-3">Estado</th><th className="p-3">Bitácora</th><th className="p-3">Acciones</th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <Fragment key={u.id}>
                  <tr className="border-t">
                    <td className="p-3">{u.nombre}</td>
                    <td className="p-3">{u.usuario ? `${u.usuario} (sin correo)` : u.email}</td>
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
                    <td className="p-3">
                      {u.rol === 'admin' ? (
                        <span className="text-xs text-neutral-400">Incluido (admin)</span>
                      ) : (
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={!!u.puede_gestionar_bitacora}
                            onChange={() => alternarPermisoBitacora(u.id, u.puede_gestionar_bitacora)}
                            className="rounded border-neutral-300"
                          />
                          Editar/eliminar/exportar
                        </label>
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => abrirReset(u)}
                        disabled={reseteando === u.id}
                        className="text-xs px-2 py-1 rounded bg-gris-calido/30 hover:bg-gris-calido/50 disabled:opacity-50"
                      >
                        {reseteando === u.id ? 'Restableciendo...' : 'Restablecer contraseña'}
                      </button>
                    </td>
                  </tr>
                  {filaResetAbierta === u.id && (
                    <tr className="border-t bg-neutral-50">
                      <td colSpan={6} className="p-3">
                        <div className="flex items-end gap-2 flex-wrap">
                          <div>
                            <label className="block text-xs mb-1">Nueva contraseña para {u.nombre} (mínimo 6 caracteres)</label>
                            <input
                              type="text"
                              value={contrasenaManual}
                              onChange={(e) => setContrasenaManual(e.target.value)}
                              placeholder="Escribe una contraseña fácil de recordar"
                              className="border rounded px-3 py-2 text-sm w-72"
                            />
                          </div>
                          <button
                            onClick={() => resetearPassword(u, contrasenaManual)}
                            disabled={reseteando === u.id || contrasenaManual.length < 6}
                            className="bg-carbon text-hueso px-3 py-2 rounded text-xs disabled:opacity-50"
                          >
                            Guardar esta contraseña
                          </button>
                          <button
                            onClick={() => resetearPassword(u, '')}
                            disabled={reseteando === u.id}
                            className="bg-neutral-200 px-3 py-2 rounded text-xs disabled:opacity-50"
                          >
                            Generar una automática
                          </button>
                          <button
                            onClick={() => setFilaResetAbierta(null)}
                            className="text-xs text-neutral-500 px-2 py-2"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
