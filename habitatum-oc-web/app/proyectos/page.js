'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { guardarProyectoActualId } from '@/lib/proyectoActual';

const VACIO = {
  nombre: '', codigo: '', cliente: '', mostrarMarca: true, nombreEmisor: '',
  nitEmpresa: '', representanteLegal: '', telefonoEmpresa: '', direccionObra: '', ciudad: '',
};

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
  // igual que el resto de este bloque de edición. Los campos nit/representante/
  // teléfono/dirección/ciudad son los datos del Contratante que se usan al
  // generar el PDF legal de un Contrato de este proyecto.
  const [formEdicion, setFormEdicion] = useState({ ...VACIO });
  const [errorEdicion, setErrorEdicion] = useState('');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

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
      nitEmpresa: p.nit_empresa || '',
      representanteLegal: p.representante_legal || '',
      telefonoEmpresa: p.telefono_empresa || '',
      direccionObra: p.direccion_obra || '',
      ciudad: p.ciudad || '',
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
        nit_empresa: formEdicion.nitEmpresa.trim() || null,
        representante_legal: formEdicion.representanteLegal.trim() || null,
        telefono_empresa: formEdicion.telefonoEmpresa.trim() || null,
        direccion_obra: formEdicion.direccionObra.trim() || null,
        ciudad: formEdicion.ciudad.trim() || null,
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
        nit_empresa: form.nitEmpresa.trim() || null,
        representante_legal: form.representanteLegal.trim() || null,
        telefono_empresa: form.telefonoEmpresa.trim() || null,
        direccion_obra: form.direccionObra.trim() || null,
        ciudad: form.ciudad.trim() || null,
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
              return (
                <div
                  key={p.id}
                  onClick={() => { if (!enEdicion) elegir(p.id); }}
                  className={`bg-hueso rounded-lg p-5 text-left border border-transparent transition-colors ${enEdicion ? '' : 'hover:border-dorado cursor-pointer'}`}
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
                      <p className="text-[11px] text-neutral-400 pt-1">Datos del Contratante para el PDF de Contratos:</p>
                      <input
                        value={formEdicion.nitEmpresa}
                        onChange={(e) => setFormEdicion({ ...formEdicion, nitEmpresa: e.target.value })}
                        placeholder="NIT de la empresa"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
                      <input
                        value={formEdicion.representanteLegal}
                        onChange={(e) => setFormEdicion({ ...formEdicion, representanteLegal: e.target.value })}
                        placeholder="Representante legal"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
                      <input
                        value={formEdicion.telefonoEmpresa}
                        onChange={(e) => setFormEdicion({ ...formEdicion, telefonoEmpresa: e.target.value })}
                        placeholder="Teléfono de la empresa"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
                      <input
                        value={formEdicion.direccionObra}
                        onChange={(e) => setFormEdicion({ ...formEdicion, direccionObra: e.target.value })}
                        placeholder="Dirección de la obra"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
                      <input
                        value={formEdicion.ciudad}
                        onChange={(e) => setFormEdicion({ ...formEdicion, ciudad: e.target.value })}
                        placeholder="Ciudad"
                        className="border rounded px-3 py-2 text-sm w-full"
                      />
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
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-lg">{p.nombre}</p>
                        {usuario.rol === 'admin' && (
                          <button
                            onClick={(e) => abrirEdicion(p, e)}
                            className="text-xs text-neutral-500 hover:text-dorado shrink-0"
                          >
                            Editar
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">Código: {p.codigo}</p>
                      {p.cliente && <p className="text-sm text-neutral-600 mt-2">{p.cliente}</p>}
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

                <p className="text-xs text-neutral-500 pt-2">
                  Datos del Contratante (opcionales aquí, se pueden completar después con "Editar") — se usan al generar el PDF de un Contrato de este proyecto:
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <input
                    placeholder="NIT de la empresa"
                    value={form.nitEmpresa}
                    onChange={(e) => setForm({ ...form, nitEmpresa: e.target.value })}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Representante legal"
                    value={form.representanteLegal}
                    onChange={(e) => setForm({ ...form, representanteLegal: e.target.value })}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Teléfono de la empresa"
                    value={form.telefonoEmpresa}
                    onChange={(e) => setForm({ ...form, telefonoEmpresa: e.target.value })}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Ciudad"
                    value={form.ciudad}
                    onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Dirección de la obra"
                    value={form.direccionObra}
                    onChange={(e) => setForm({ ...form, direccionObra: e.target.value })}
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
