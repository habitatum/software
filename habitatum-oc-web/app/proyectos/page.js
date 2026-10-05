'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { guardarProyectoActualId, obtenerProyectoActualId, limpiarProyectoActual } from '@/lib/proyectoActual';

const FINANZAS_VACIO = {
  modelo: 'ADMINISTRACION_DELEGADA',
  modalidad: 'AIU', porcentajeUtilidad: '', porcentajeA: '', porcentajeI: '', porcentajeU: '',
  valorContratoCliente: '', cuentaReceptora: 'HABITATUM', topeCajaMenor: '1000000',
};
const VACIO = { nombre: '', codigo: '', cliente: '', mostrarMarca: true, nombreEmisor: '', porcentajeAdministracion: '', ...FINANZAS_VACIO };

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

// Valida y arma los datos financieros de un proyecto TODO COSTO (tabla proyectos_finanzas,
// que por seguridad solo puede leer/escribir un admin).
function validarFinanzas(f) {
  if (f.modelo !== 'TODO_COSTO') return { ok: true };
  if (f.modalidad === 'AIU') {
    if (num(f.porcentajeA) + num(f.porcentajeI) + num(f.porcentajeU) <= 0) return { ok: false, error: 'Define los % de A, I y U del proyecto.' };
  } else if (num(f.porcentajeUtilidad) <= 0) {
    return { ok: false, error: 'Define el % de utilidad del proyecto.' };
  }
  if (num(f.topeCajaMenor) <= 0) return { ok: false, error: 'El tope de caja menor debe ser mayor a 0.' };
  return { ok: true };
}
function filaFinanzas(proyectoId, f) {
  const esAIU = f.modalidad === 'AIU';
  return {
    proyecto_id: proyectoId,
    modalidad_facturacion: f.modalidad,
    porcentaje_utilidad: esAIU ? num(f.porcentajeA) + num(f.porcentajeI) + num(f.porcentajeU) : num(f.porcentajeUtilidad),
    porcentaje_a: esAIU ? num(f.porcentajeA) : 0,
    porcentaje_i: esAIU ? num(f.porcentajeI) : 0,
    porcentaje_u: esAIU ? num(f.porcentajeU) : 0,
    valor_contrato_cliente: f.valorContratoCliente === '' ? null : num(f.valorContratoCliente),
    cuenta_receptora: f.cuentaReceptora,
    actualizado_en: new Date().toISOString(),
  };
}

// Bloque de formulario compartido (crear / editar) para el modelo de contratación.
function CamposContratacion({ f, set }) {
  const CAMPO = 'border rounded px-3 py-2 text-sm w-full';
  const todoCosto = f.modelo === 'TODO_COSTO';
  return (
    <div className="space-y-2 border-t pt-3">
      <label className="text-xs font-medium text-neutral-600">Modelo de contratación con el cliente</label>
      <select value={f.modelo} onChange={(e) => set({ modelo: e.target.value })} className={CAMPO}>
        <option value="ADMINISTRACION_DELEGADA">Administración delegada</option>
        <option value="TODO_COSTO">Todo costo</option>
      </select>
      {todoCosto && (
        <div className="space-y-2 bg-white/60 rounded p-3 border border-dorado/40">
          <p className="text-[11px] text-dorado font-medium">Solo visible para administradores</p>
          <label className="text-xs text-neutral-600">Facturación al cliente</label>
          <select
            value={f.modalidad}
            onChange={(e) => set({ modalidad: e.target.value, ...(e.target.value === 'SIN_FACTURA' ? { cuentaReceptora: 'PERSONAL' } : {}) })}
            className={CAMPO}
          >
            <option value="AIU">AIU con IVA sobre la utilidad</option>
            <option value="IVA">IVA sobre el total</option>
            <option value="SIN_FACTURA">Sin facturación</option>
          </select>
          {f.modalidad === 'AIU' ? (
            <div className="grid grid-cols-3 gap-2">
              <input type="number" step="0.01" placeholder="% A" value={f.porcentajeA} onChange={(e) => set({ porcentajeA: e.target.value })} className={CAMPO} />
              <input type="number" step="0.01" placeholder="% I" value={f.porcentajeI} onChange={(e) => set({ porcentajeI: e.target.value })} className={CAMPO} />
              <input type="number" step="0.01" placeholder="% U" value={f.porcentajeU} onChange={(e) => set({ porcentajeU: e.target.value })} className={CAMPO} />
              <p className="col-span-3 text-[11px] text-neutral-500">
                Margen total {num(f.porcentajeA) + num(f.porcentajeI) + num(f.porcentajeU)}% · precio de venta = costo × (1 + A + I + U). El IVA se liquida sobre la U.
              </p>
            </div>
          ) : (
            <div>
              <input type="number" step="0.01" placeholder="% Utilidad sobre el costo (ej. 25)" value={f.porcentajeUtilidad} onChange={(e) => set({ porcentajeUtilidad: e.target.value })} className={CAMPO} />
              <p className="text-[11px] text-neutral-500 mt-1">Precio de venta = costo × (1 + utilidad). Aplica igual a todo el proyecto.</p>
            </div>
          )}
          <input type="number" placeholder="Valor contratado con el cliente (opcional)" value={f.valorContratoCliente} onChange={(e) => set({ valorContratoCliente: e.target.value })} className={CAMPO} />
          <label className="text-xs text-neutral-600">Cuenta que recibe los pagos del cliente</label>
          <select value={f.cuentaReceptora} onChange={(e) => set({ cuentaReceptora: e.target.value })} className={CAMPO}>
            <option value="HABITATUM">Cuenta HABITATUM</option>
            <option value="PERSONAL">Cuenta personal</option>
          </select>
          <label className="text-xs text-neutral-600">Tope de caja menor (se legaliza en una OC al alcanzarlo)</label>
          <input type="number" value={f.topeCajaMenor} onChange={(e) => set({ topeCajaMenor: e.target.value })} className={CAMPO} />
          {f.modalidad === 'SIN_FACTURA' && (
            <p className="text-[11px] text-neutral-500">Sin facturación: recuerda desmarcar la marca HABITATUM y poner tu nombre como emisor de los documentos.</p>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [formEdicion, setFormEdicion] = useState({ nombre: '', codigo: '', cliente: '', mostrarMarca: true, nombreEmisor: '', porcentajeAdministracion: '', ...FINANZAS_VACIO });
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
  const [obraElegida, setObraElegida] = useState({}); // chat_id -> proyecto elegido

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

  // Vincula un grupo pendiente a una obra con un uso explícito (Bitácora o Finanzas).
  // Pide confirmación nombrando el uso y avisa si reemplaza el grupo actual de esa obra.
  async function vincularGrupo(grupo, proyectoId, tipo) {
    const p = proyectos.find((x) => x.id === proyectoId);
    if (!p) { alert('Elige primero la obra.'); return; }
    const esFinanzas = tipo === 'FINANZAS';
    const uso = esFinanzas ? 'FINANZAS (facturas → Órdenes de Compra)' : 'BITÁCORA (fotos de avance)';
    const actual = esFinanzas ? p.telegram_chat_id_finanzas : p.telegram_chat_id;
    const aviso = actual ? `\n\nATENCIÓN: ${p.nombre} ya tiene un grupo de ${esFinanzas ? 'finanzas' : 'bitácora'}; se reemplazará por este.` : '';
    if (!window.confirm(`¿Vincular "${grupo.titulo}" como ${uso} de ${p.nombre}?${aviso}`)) return;
    setVinculando(grupo.chat_id);
    const supabase = crearClienteSupabase();
    const columna = esFinanzas ? 'telegram_chat_id_finanzas' : 'telegram_chat_id';
    const { data: filas, error: err } = await supabase.from('proyectos').update({ [columna]: grupo.chat_id }).eq('id', proyectoId).select('id');
    if (err || !filas?.length) {
      alert('No se pudo vincular: ' + (err?.message || 'la obra no se actualizó (revisa que tengas rol de administrador).'));
      setVinculando(null);
      return;
    }
    if (esFinanzas) await activarBotonesBot();
    // Solo sale de pendientes si la vinculación quedó guardada.
    await supabase.from('telegram_grupos_pendientes').delete().eq('chat_id', grupo.chat_id);
    cargar();
    cargarGruposPendientes();
    setVinculando(null);
  }

  async function desvincularGrupo(proyectoId, e, tipo = 'BITACORA') {
    e.stopPropagation();
    const texto = tipo === 'FINANZAS'
      ? '¿Desvincular el grupo de FINANZAS? Las OC ya creadas no se pierden.'
      : '¿Desvincular el grupo de Telegram de este proyecto? Las fotos que ya se recibieron no se pierden.';
    if (!window.confirm(texto)) return;
    const supabase = crearClienteSupabase();
    await supabase.from('proyectos').update(tipo === 'FINANZAS' ? { telegram_chat_id_finanzas: null } : { telegram_chat_id: null }).eq('id', proyectoId);
    cargar();
  }
  // Activa los botones (callback_query) del bot de finanzas en el webhook de Telegram.
  async function activarBotonesBot() {
    const supabase = crearClienteSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/telegram/configurar', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) alert('El grupo quedó vinculado, pero no se pudieron activar los botones del bot: ' + (j.error || j.descripcion || res.status));
    return j;
  }
  const [diagnostico, setDiagnostico] = useState(null);
  async function revisarBot() {
    setDiagnostico({ cargando: true });
    const j = await activarBotonesBot();
    setDiagnostico(j || { error: 'Sin respuesta' });
    cargarGruposPendientes();
  }

  function elegir(id) {
    guardarProyectoActualId(id);
    router.push('/dashboard');
  }

  async function abrirEdicion(p, e) {
    e.stopPropagation();
    setEditandoId(p.id);
    let fin = null;
    if (p.modelo_contratacion === 'TODO_COSTO') {
      const supabase = crearClienteSupabase();
      const { data } = await supabase.from('proyectos_finanzas').select('*').eq('proyecto_id', p.id).maybeSingle();
      fin = data;
    }
    setFormEdicion({
      modelo: p.modelo_contratacion || 'ADMINISTRACION_DELEGADA',
      modalidad: fin?.modalidad_facturacion || 'AIU',
      porcentajeUtilidad: fin && fin.modalidad_facturacion !== 'AIU' ? String(fin.porcentaje_utilidad ?? '') : '',
      porcentajeA: fin?.modalidad_facturacion === 'AIU' ? String(fin.porcentaje_a ?? '') : '',
      porcentajeI: fin?.modalidad_facturacion === 'AIU' ? String(fin.porcentaje_i ?? '') : '',
      porcentajeU: fin?.modalidad_facturacion === 'AIU' ? String(fin.porcentaje_u ?? '') : '',
      valorContratoCliente: fin?.valor_contrato_cliente != null ? String(fin.valor_contrato_cliente) : '',
      cuentaReceptora: fin?.cuenta_receptora || 'HABITATUM',
      topeCajaMenor: String(p.tope_caja_menor ?? 1000000),
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
    const vf = validarFinanzas(formEdicion);
    if (!vf.ok) { setErrorEdicion(vf.error); return; }
    setGuardandoEdicion(true);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase
      .from('proyectos')
      .update({
        modelo_contratacion: formEdicion.modelo,
        tope_caja_menor: num(formEdicion.topeCajaMenor) || 1000000,
        nombre: formEdicion.nombre.trim(),
        codigo: formEdicion.codigo.trim(),
        cliente: formEdicion.cliente.trim() || null,
        mostrar_marca_habitatum: formEdicion.mostrarMarca,
        nombre_emisor: formEdicion.mostrarMarca ? null : formEdicion.nombreEmisor.trim(),
        porcentaje_administracion: formEdicion.porcentajeAdministracion === '' ? null : Number(formEdicion.porcentajeAdministracion),
      })
      .eq('id', id);
    if (!err && formEdicion.modelo === 'TODO_COSTO') {
      const { error: errF } = await supabase.from('proyectos_finanzas').upsert(filaFinanzas(id, formEdicion));
      // El precio de venta del presupuesto depende del margen: se recalcula al guardar.
      if (!errF) await supabase.rpc('convertir_presupuesto_a_todo_costo', { p_proyecto: id });
      if (errF) { setGuardandoEdicion(false); setErrorEdicion(errF.message); return; }
    }
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

    const vf = validarFinanzas(form);
    if (!vf.ok) { setError(vf.error); return; }
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { data, error: err } = await supabase
      .from('proyectos')
      .insert({
        modelo_contratacion: form.modelo,
        tope_caja_menor: num(form.topeCajaMenor) || 1000000,
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim(),
        cliente: form.cliente.trim() || null,
        mostrar_marca_habitatum: form.mostrarMarca,
        nombre_emisor: form.mostrarMarca ? null : form.nombreEmisor.trim(),
        porcentaje_administracion: form.porcentajeAdministracion === '' ? null : Number(form.porcentajeAdministracion),
      })
      .select()
      .single();
    if (!err && form.modelo === 'TODO_COSTO') {
      const { error: errF } = await supabase.from('proyectos_finanzas').upsert(filaFinanzas(data.id, form));
      if (errF) { setGuardando(false); setError('El proyecto se creó, pero no se guardó la configuración financiera: ' + errF.message); return; }
    }
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
                      <CamposContratacion f={formEdicion} set={(cambios) => setFormEdicion({ ...formEdicion, ...cambios })} />
                      {formEdicion.modelo !== 'TODO_COSTO' && <div>
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
                      </div>}
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
                      <p className="text-xs text-neutral-500 mt-1">
                        Código: {p.codigo}
                        <span className="ml-2 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-carbon/10 text-carbon align-middle">
                          {p.modelo_contratacion === 'TODO_COSTO' ? 'Todo costo' : 'Adm. delegada'}
                        </span>
                      </p>
                      {p.cliente && <p className="text-sm text-neutral-600 mt-2">{p.cliente}</p>}
                      {p.modelo_contratacion !== 'TODO_COSTO' && p.porcentaje_administracion != null && (
                        <p className="text-xs text-neutral-500 mt-2">Administración: {p.porcentaje_administracion}%</p>
                      )}
                      {!p.mostrar_marca_habitatum && (
                        <p className="text-xs text-dorado mt-2">Sin marca HABITATUM en documentos</p>
                      )}
                      {p.telegram_chat_id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <p className="text-xs text-green-700">Grupo de bitácora vinculado (fotos de avance)</p>
                          {usuario.rol === 'admin' && (
                            <button onClick={(e) => desvincularGrupo(p.id, e)} className="text-xs text-neutral-400 hover:text-red-600 underline">
                              Desvincular
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-400 mt-2">Sin grupo de bitácora vinculado</p>
                      )}
                      {(p.telegram_chat_id_finanzas ? (
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-green-700">Grupo de finanzas vinculado (facturas → OC)</p>
                          {usuario.rol === 'admin' && (
                            <button onClick={(e) => desvincularGrupo(p.id, e, 'FINANZAS')} className="text-xs text-neutral-400 hover:text-red-600 underline">
                              Desvincular
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-400 mt-1">Sin grupo de finanzas vinculado</p>
                      ))}
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
              Estos grupos le escribieron al bot pero todavía no están asignados. Elige el proyecto y el uso:
              <strong> Bitácora</strong> (fotos de avance) o <strong>Finanzas</strong> (facturas que se convierten en Órdenes de Compra
              y gastos de caja menor).
            </p>
            <div className="space-y-2">
              {gruposPendientes.map((g) => (
                <div key={g.chat_id} className="bg-white rounded border p-3 space-y-2">
                  <p className="text-sm font-medium">{g.titulo}</p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <select
                      value={obraElegida[g.chat_id] || ''}
                      disabled={vinculando === g.chat_id}
                      onChange={(e) => setObraElegida({ ...obraElegida, [g.chat_id]: e.target.value })}
                      className="border rounded px-2 py-1.5 text-sm sm:flex-1"
                      aria-label={`Obra para el grupo ${g.titulo}`}
                    >
                      <option value="" disabled>1. Elige la obra…</option>
                      {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <button
                        disabled={!obraElegida[g.chat_id] || vinculando === g.chat_id}
                        onClick={() => vincularGrupo(g, obraElegida[g.chat_id], 'BITACORA')}
                        className="border border-carbon text-carbon px-3 py-1.5 rounded text-sm disabled:opacity-40 whitespace-nowrap"
                      >2. Vincular como Bitácora</button>
                      <button
                        disabled={!obraElegida[g.chat_id] || vinculando === g.chat_id}
                        onClick={() => vincularGrupo(g, obraElegida[g.chat_id], 'FINANZAS')}
                        className="bg-carbon text-hueso px-3 py-1.5 rounded text-sm disabled:opacity-40 whitespace-nowrap"
                      >2. Vincular como Finanzas</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {usuario.rol === 'admin' && (
          <div className="bg-hueso rounded-lg p-5 mb-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-medium">Bot de Telegram</h2>
                <p className="text-xs text-neutral-500">Revisa la conexión con Telegram y activa los botones del bot de finanzas.</p>
              </div>
              <button onClick={revisarBot} className="border border-dorado text-dorado px-4 py-2 rounded text-sm hover:bg-white">
                {diagnostico?.cargando ? 'Revisando...' : 'Revisar conexión del bot'}
              </button>
            </div>
            {diagnostico && !diagnostico.cargando && (
              <div className="mt-3 text-xs bg-white rounded border p-3 space-y-1">
                <p><strong>Bot:</strong> {diagnostico.bot?.usuario || '—'} · {diagnostico.bot?.lee_todos_los_mensajes_de_grupos ? 'lee todos los mensajes de los grupos' : 'solo lee comandos y menciones (modo privacidad activo: hazlo administrador del grupo)'}</p>
                <p><strong>Webhook:</strong> {diagnostico.webhook || '—'} {diagnostico.ok ? '✅' : '❌'}</p>
                <p><strong>Mensajes en cola:</strong> {diagnostico.antes?.mensajes_en_cola ?? '—'}</p>
                <p><strong>Último error de Telegram:</strong> {diagnostico.antes?.ultimo_error ? `${diagnostico.antes.ultimo_error} (${diagnostico.antes.fecha_ultimo_error})` : 'ninguno'}</p>
                <p><strong>Tipos de mensaje activos:</strong> {(diagnostico.ahora?.tipos_permitidos || []).join(', ') || 'todos'}</p>
                {(diagnostico.gemini || []).length > 0 && (
                  <div className="pt-1">
                    <p><strong>Lectura con IA (Gemini):</strong></p>
                    {diagnostico.gemini.map((g) => <p key={g.modelo} className="pl-3 break-all">· {g.modelo}: {g.estado}</p>)}
                  </div>
                )}
                {diagnostico.error && <p className="text-red-600">{diagnostico.error}</p>}
              </div>
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
                    <CamposContratacion f={form} set={(cambios) => setForm({ ...form, ...cambios })} />
                  </div>
                  {form.modelo !== 'TODO_COSTO' && <div className="sm:col-span-2">
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
                  </div>}
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
