'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { guardarProyectoActualId, obtenerProyectoActualId, limpiarProyectoActual } from '@/lib/proyectoActual';

const VACIO = { nombre: '', codigo: '', cliente: '', mostrarMarca: true, nombreEmisor: '', porcentajeAdministracion: '' };

export default function SeleccionarProyecto() {
  const { usuario, cargando } = useUsuarioActual();
  const router = useRouter();
  const [proyectos, setProyectos] = useState([]);
  const [cargandoProyectos, setCargandoProyectos] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [editandoId, setEditandoId] = useState(null);
  // "codigo" se agrega aquí para poder editarlo después de creado el proyecto
  // (antes solo se podía asignar una vez, al crear). Sigue siendo solo-admin,
  // igual que el resto de este bloque de edición.
  const [formEdicion, setFormEdicion] = useState({ nombre: '', codigo: '', cliente: '', mostrarMarca: true, nombreEmisor: '', porcentajeAdministracion: '' });
  const [errorEdicion, setErrorEdicion] = useState('');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  // Eliminar proyecto (solo Admin): doble verificación antes de borrar de
  // verdad — hay que escribir el código exacto del proyecto y luego confirmar
  // en un segundo diálogo. El borrado es irreversible: en cascada se lleva
  // Contratos, Órdenes de Compra, ítems, pagos, Presupuesto, Cortes y Bitácora.
  const [eliminandoId, setEliminandoId] = useState(null);
  const [confirmacionCodigo, setConfirmacionCodigo] = useState('');
  const [errorEliminar, setErrorEliminar] = useState('');
  const [borrando, setBorrando] = useState(false);

  const [gruposPendientes, setGruposPendientes] = useState([]);
  const [vinculando, setVinculando] = useState(null); // chat_id que se está vinculando

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('proyectos').select('*').eq('estado', 'activo').order('codigo');
    setProyectos(data || []);
    setCargandoProyectos(false);
  }
  async function cargarGruposPendientes() {
    const supabase = crearClienteSupabase();
    const { data } = await supabase.from('telegram_grupos_pendientes').select('*').order('primer_mensaje_en');
    setGruposPendientes(data || []);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line
  useEffect(() => { if (usuario?.rol === 'admin') cargarGruposPendientes(); }, [usuario]); // eslint-disable-line

  async function vincularGrupo(chatId, proyectoId) {
    if (!proyectoId) return;
    setVinculando(chatId);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('proyectos').update({ telegram_chat_id: chatId }).eq('id', proyectoId);
    if (!err) {
      await supabase.from('telegram_grupos_pendientes').delete().eq('chat_id', chatId);
      cargar();
      cargarGruposPendientes();
    } else {
      alert('No se pudo vincular: ' + err.message);
    }
    setVinculando(null);
  }

  async function desvincularGrupo(proyectoId, e) {
    e.stopPropagation();
    if (!window.confirm('¿Desvincular el grupo de Telegram de este proyecto? Las fotos que ya se recibieron no se pierden.')) return;
    const supabase = crearClienteSupabase();
    await supabase.from('proyectos').update({ telegram_chat_id: null }).eq('id', proyectoId);
    cargar();
  }

  function elegir(id) {
    guardarProyectoActualId(id);
    router.push('/dashboard');
  }

  function abrirEdicion(p, e) {
    e.stopPropagation();
    setEditandoId(p.id);
    setFormEdicion({
      nombre: p.nombre,
      codigo: p.codigo,
      cliente: p.cliente || '',
      mostrarMarca: p.mostrar_marca_habitatum,
      nombreEmisor: p.nombre_emisor || '',
      porcentajeAdministracion: p.porcentaje_administracion ?? '',
    });
    setErrorEdicion('');
  }

  function cancelarEdicion(e) {
    e.stopPropagation();
    setEditandoId(null);
    setErrorEdicion('');
  }

  async function guardarEdicion(id, e) {
    e.stopPropagation();
    setErrorEdicion('');
    if (!formEdicion.nombre.trim()) {
      setErrorEdicion('El nombre es obligatorio.');
      return;
    }
    if (!formEdicion.codigo.trim() || !/^\d+$/.test(formEdicion.codigo.trim())) {
      setErrorEdicion('El código debe ser un número (ej. 001).');
      return;
    }
    if (!formEdicion.mostrarMarca && !formEdicion.nombreEmisor.trim()) {
      setErrorEdicion('Escribe el nombre que debe aparecer en los documentos de este proyecto.');
      return;
    }
    setGuardandoEdicion(true);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase
      .from('proyectos')
      .update({
        nombre: formEdicion.nombre.trim(),
        codigo: formEdicion.codigo.trim(),
        cliente: formEdicion.cliente.trim() || null,
        mostrar_marca_habitatum: formEdicion.mostrarMarca,
        nombre_emisor: formEdicion.mostrarMarca ? null : formEdicion.nombreEmisor.trim(),
        porcentaje_administracion: formEdicion.porcentajeAdministracion === '' ? null : Number(formEdicion.porcentajeAdministracion),
      })
      .eq('id', id);
    setGuardandoEdicion(false);
    if (err) {
      setErrorEdicion(err.message.includes('duplicate') ? 'Ya existe un proyecto con ese código.' : err.message);
      return;
    }
    setEditandoId(null);
    cargar();
  }

  function abrirEliminar(p, e) {
    e.stopPropagation();
    setEliminandoId(p.id);
    setConfirmacionCodigo('');
    setErrorEliminar('');
  }

  function cancelarEliminar(e) {
    e.stopPropagation();
    setEliminandoId(null);
    setConfirmacionCodigo('');
    setErrorEliminar('');
  }

  // Doble verificación: (1) el código escrito debe coincidir exactamente con
  // el del proyecto, (2) un último window.confirm con la advertencia completa
  // de todo lo que se borra en cascada. Solo entonces se ejecuta el delete.
  async function confirmarEliminar(p, e) {
    e.stopPropagation();
    setErrorEliminar('');
    if (confirmacionCodigo.trim() !== p.codigo) {
      setErrorEliminar('El código no coincide. Escríbelo exactamente igual para confirmar.');
      return;
    }
    if (!window.confirm(
      `Esta acción es IRREVERSIBLE.\n\nSe eliminará para siempre el proyecto "${p.nombre}" y TODO lo que contiene: Contratos, Órdenes de Compra, ítems, pagos, Presupuesto, Cortes de Control Presupuestal y Bitácora.\n\n¿Confirmas que quieres eliminarlo definitivamente?`
    )) {
      return;
    }
    setBorrando(true);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('proyectos').delete().eq('id', p.id);
    setBorrando(false);
    if (err) {
      setErrorEliminar(
        err.code === '23503'
          ? 'No se pudo eliminar: todavía hay datos vinculados que no se pudieron borrar automáticamente.'
          : err.message
      );
      return;
    }
    if (obtenerProyectoActualId() === p.id) {
      limpiarProyectoActual();
    }
    setEliminandoId(null);
    cargar();
  }

  async function crearProyecto(e) {
    e.preventDefault();
    setError('');

    if (!form.nombre.trim() || !form.codigo.trim()) {
      setError('Nombre y código son obligatorios.');
      return;
    }
    if (!/^\d+$/.test(form.codigo.trim())) {
      setError('El código debe ser un número (ej. 001). Tú decides cuál asignar cada vez.');
      return;
    }
    if (!form.mostrarMarca && !form.nombreEmisor.trim()) {
      setError('Escribe el nombre que debe aparecer en los documentos de este proyecto.');
      return;
    }

    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { data, error: err } = await supabase
      .from('proyectos')
      .insert({
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim(),
        cliente: form.cliente.trim() || null,
        mostrar_marca_habitatum: form.mostrarMarca,
        nombre_emisor: form.mostrarMarca ? null : form.nombreEmisor.trim(),
        porcentaje_administracion: form.porcentajeAdministracion === '' ? null : Number(form.porcentajeAdministracion),
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
            {proyectos.map((p) => {
              const enEdicion = editandoId === p.id;
              const enEliminacion = eliminandoId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => { if (!enEdicion && !enEliminacion) elegir(p.id); }}
                  className={`bg-hueso rounded-lg p-5 text-left border transition-colors ${enEliminacion ? 'border-red-300' : 'border-transparent'} ${enEdicion || enEliminacion ? '' : 'hover:border-dorado cursor-pointer'}`}
                >
                  {enEdicion ? (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        value={formEdicion.nombre}
                        onChange={(e) => setFormEdicion({ ...formEdicion, nombre: e.target.value })}
                        placeholder="Nombre del proyecto"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
                      <div>
                        <input
                          inputMode="numeric"
                          value={formEdicion.codigo}
                          onChange={(e) => setFormEdicion({ ...formEdicion, codigo: e.target.value })}
                          placeholder="Código consecutivo (ej. 001)"
                          className="border rounded px-3 py-2 text-sm w-full"
                        />
                        <p className="text-[11px] text-neutral-400 mt-1">
                          Cambiar el código no actualiza los contratos que ya se crearon con el código anterior.
                        </p>
                      </div>
                      <input
                        value={formEdicion.cliente}
                        onChange={(e) => setFormEdicion({ ...formEdicion, cliente: e.target.value })}
                        placeholder="Cliente (opcional)"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
                      <div>
                        <input
                          type="number"
                          step="0.01"
                          value={formEdicion.porcentajeAdministracion}
                          onChange={(e) => setFormEdicion({ ...formEdicion, porcentajeAdministracion: e.target.value })}
                          placeholder="% Administración (ej. 12)"
                          className="border rounded px-3 py-2 text-sm w-full"
                        />
                        <p className="text-[11px] text-neutral-400 mt-1">
                          Se usa en Presupuesto para calcular la Administración sobre lo ejecutado + anticipos pendientes.
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={formEdicion.mostrarMarca}
                          onChange={(e) => setFormEdicion({ ...formEdicion, mostrarMarca: e.target.checked })}
                        />
                        Mostrar marca HABITATUM en los documentos
                      </label>
                      {!formEdicion.mostrarMarca && (
                        <input
                          value={formEdicion.nombreEmisor}
                          onChange={(e) => setFormEdicion({ ...formEdicion, nombreEmisor: e.target.value })}
                          placeholder="Nombre a mostrar en los documentos"
                          className="border rounded px-3 py-2 text-sm w-full"
                        />
                      )}
                      {errorEdicion && <p className="text-red-600 text-xs">{errorEdicion}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => guardarEdicion(p.id, e)}
                          disabled={guardandoEdicion}
                          className="bg-carbon text-hueso px-3 py-1.5 rounded text-xs disabled:opacity-50"
                        >
                          {guardandoEdicion ? 'Guardando...' : 'Guardar'}
                        </button>
                        <button onClick={cancelarEdicion} className="px-3 py-1.5 rounded text-xs border">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : enEliminacion ? (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <p className="text-sm font-semibold text-red-700">Eliminar &quot;{p.nombre}&quot; definitivamente</p>
                      <p className="text-xs text-neutral-600">
                        Esto borra para siempre este proyecto y TODO lo que contiene: Contratos, Órdenes de
                        Compra, ítems, pagos, Presupuesto, Cortes de Control Presupuestal y Bitácora. No se
                        puede deshacer.
                      </p>
                      <p className="text-xs text-neutral-600">
                        Para confirmar, escribe el código del proyecto (<strong>{p.codigo}</strong>):
                      </p>
                      <input
                        value={confirmacionCodigo}
                        onChange={(e) => setConfirmacionCodigo(e.target.value)}
                        placeholder={`Escribe ${p.codigo}`}
                        className="border border-red-300 rounded px-3 py-2 text-sm w-full"
                      />
                      {errorEliminar && <p className="text-red-600 text-xs">{errorEliminar}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => confirmarEliminar(p, e)}
                          disabled={borrando}
                          className="bg-red-600 text-white px-3 py-1.5 rounded text-xs disabled:opacity-50"
                        >
                          {borrando ? 'Eliminando...' : 'Eliminar definitivamente'}
                        </button>
                        <button onClick={cancelarEliminar} className="px-3 py-1.5 rounded text-xs border">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-lg">{p.nombre}</p>
                        {usuario.rol === 'admin' && (
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={(e) => abrirEdicion(p, e)}
                              className="text-xs text-neutral-500 hover:text-dorado"
                            >
                              Editar
                            </button>
                            <button
                              onClick={(e) => abrirEliminar(p, e)}
                              className="text-xs text-neutral-500 hover:text-red-600"
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">Código: {p.codigo}</p>
                      {p.cliente && <p className="text-sm text-neutral-600 mt-2">{p.cliente}</p>}
                      {p.porcentaje_administracion != null && (
                        <p className="text-xs text-neutral-500 mt-2">Administración: {p.porcentaje_administracion}%</p>
                      )}
                      {!p.mostrar_marca_habitatum && (
                        <p className="text-xs text-dorado mt-2">Sin marca HABITATUM en documentos</p>
                      )}
                      {p.telegram_chat_id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <p className="text-xs text-green-700">Grupo de Telegram vinculado</p>
                          {usuario.rol === 'admin' && (
                            <button onClick={(e) => desvincularGrupo(p.id, e)} className="text-xs text-neutral-400 hover:text-red-600 underline">
                              Desvincular
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-400 mt-2">Sin grupo de Telegram vinculado</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {proyectos.length === 0 && (
              <p className="text-gris-calido col-span-2 text-center py-8">Aún no hay proyectos creados.</p>
            )}
          </div>
        )}

        {usuario.rol === 'admin' && gruposPendientes.length > 0 && (
          <div className="bg-hueso rounded-lg p-5 mb-6">
            <h2 className="font-medium mb-1">Grupos de Telegram por vincular</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Estos grupos enviaron una foto pero todavía no están asignados a ningún proyecto. Elige a cuál
              proyecto pertenecen para que sus fotos empiecen a llenar la Bitácora y el Registro Fotográfico.
            </p>
            <div className="space-y-2">
              {gruposPendientes.map((g) => (
                <div key={g.chat_id} className="flex items-center gap-2 bg-white rounded border p-2">
                  <span className="text-sm flex-1">{g.titulo}</span>
                  <select
                    defaultValue=""
                    disabled={vinculando === g.chat_id}
                    onChange={(e) => vincularGrupo(g.chat_id, e.target.value)}
                    className="border rounded px-2 py-1 text-sm"
                  >
                    <option value="" disabled>Vincular a proyecto...</option>
                    {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
              ))}
            </div>
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
                    inputMode="numeric"
                    placeholder="Código consecutivo (ej. 001)"
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
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="% Administración (ej. 12, opcional)"
                      value={form.porcentajeAdministracion}
                      onChange={(e) => setForm({ ...form, porcentajeAdministracion: e.target.value })}
                      className="border rounded px-3 py-2 text-sm w-full"
                    />
                    <p className="text-[11px] text-neutral-400 mt-1">
                      Se usa en Presupuesto para calcular la Administración sobre lo ejecutado + anticipos pendientes.
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.mostrarMarca}
                    onChange={(e) => setForm({ ...form, mostrarMarca: e.target.checked })}
                  />
                  Mostrar el nombre y logo de HABITATUM en los documentos (PDF) de este proyecto
                </label>

                {!form.mostrarMarca && (
                  <input
                    required
                    placeholder="Nombre a mostrar en los documentos (ej. Arq. Andrés David Hincapié)"
                    value={form.nombreEmisor}
                    onChange={(e) => setForm({ ...form, nombreEmisor: e.target.value })}
                    className="border rounded px-3 py-2 text-sm w-full"
                  />
                )}

                {error && <p className="text-red-600 text-sm">{error}</p>}
                <div className="flex gap-2">
                  <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
                    {guardando ? 'Creando...' : 'Crear y entrar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMostrarForm(false); setError(''); setForm(VACIO); }}
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
