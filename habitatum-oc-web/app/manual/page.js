'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';

// Manual de uso y mantenimiento de la obra (048). Fase 1: estado, preparación
// y descarga del PDF. La información la alimenta el chat de la obra (residente
// virtual); la edición en pantalla llega en la fase 2.
export default function ManualMantenimiento() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [datos, setDatos] = useState(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const puedeEditar = usuario?.rol === 'admin' || usuario?.rol === 'operativo';

  async function cargar() {
    setCargandoDatos(true);
    const s = crearClienteSupabase();
    const id = proyecto.id;
    const [man, con, aca, sis, rut, anx] = await Promise.all([
      s.from('manual_mantenimiento').select('*').eq('proyecto_id', id).maybeSingle(),
      s.from('manual_contactos').select('*').eq('proyecto_id', id).order('orden'),
      s.from('manual_acabados').select('*').eq('proyecto_id', id).order('espacio').order('orden'),
      s.from('manual_sistemas').select('id, titulo, garantia_meses').eq('proyecto_id', id).order('orden'),
      s.from('manual_rutinas').select('id').eq('proyecto_id', id),
      s.from('manual_anexos').select('id, titulo').eq('proyecto_id', id).order('orden'),
    ]);
    setDatos({ manual: man.data, contactos: con.data || [], acabados: aca.data || [], sistemas: sis.data || [], rutinas: rut.data || [], anexos: anx.data || [] });
    setCargandoDatos(false);
  }
  useEffect(() => { if (proyecto) cargar(); }, [proyecto]); // eslint-disable-line

  async function preparar() {
    setTrabajando(true); setMensaje('');
    const { data, error } = await crearClienteSupabase().rpc('manual_inicializar', { p_proyecto: proyecto.id });
    setTrabajando(false);
    if (error) { setMensaje(error.message); return; }
    setMensaje(data?.plantilla_base
      ? `Manual preparado: plantilla base de HABITATUM y ${data.contactos_nuevos} contactos importados de los contratos.`
      : `Directorio actualizado: ${data?.contactos_nuevos || 0} contactos nuevos desde los contratos.`);
    cargar();
  }

  async function descargar() {
    setMensaje('');
    // Se abre la ventana en el clic (si no, el iPhone la bloquea) y luego se carga el PDF.
    const ventana = window.open('', '_blank');
    const s = crearClienteSupabase();
    const { data: { session } } = await s.auth.getSession();
    const r = await fetch(`/api/manual/${proyecto.id}/pdf`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    if (!r.ok) { if (ventana) ventana.close(); setMensaje(await r.text()); return; }
    const url = URL.createObjectURL(await r.blob());
    if (ventana) ventana.location.href = url; else window.location.href = url;
  }

  async function cambiarMostrarContratistas(valor) {
    const { error } = await crearClienteSupabase().from('manual_mantenimiento')
      .update({ mostrar_contratistas: valor }).eq('proyecto_id', proyecto.id);
    if (error) { setMensaje(error.message); return; }
    cargar();
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;
  const m = datos?.manual;
  // 049: en todo costo las garantías y la posventa son del responsable de la obra.
  const todoCosto = proyecto.modelo_contratacion === 'TODO_COSTO';
  const responsable = proyecto.mostrar_marca_habitatum === false ? (proyecto.nombre_emisor || 'el constructor') : 'HABITATUM';
  const mostrarContratistas = m ? (m.mostrar_contratistas ?? !todoCosto) : false;
  const sistemasConGarantia = (datos?.sistemas || []).filter((x) => Number(x.garantia_meses) > 0);
  const pendientes = [];
  if (m) {
    if (!m.cliente || m.cliente === 'Reservado') pendientes.push('Nombre del cliente');
    if (!m.direccion) pendientes.push('Dirección del inmueble');
    if (!m.fecha_entrega) pendientes.push('Fecha de entrega (base de las garantías)');
    if (todoCosto) {
      if (!m.contacto_postventa) pendientes.push(`Contacto de posventa de ${responsable} (nombre y teléfono)`);
      if (!sistemasConGarantia.length) pendientes.push(`Garantías por sistema que da ${responsable} (meses)`);
    } else {
      const sinTel = datos.contactos.filter((c) => !c.telefono).map((c) => c.empresa);
      if (sinTel.length) pendientes.push(`Teléfono de: ${[...new Set(sinTel)].join(', ')}`);
      if (!datos.contactos.some((c) => Number(c.garantia_meses) > 0)) pendientes.push('Garantías de los contratistas');
    }
    if (!datos.acabados.length) pendientes.push('Acabados y materiales (pisos, pinturas, enchapes, griferías…)');
  }
  const tarjetas = m ? [
    ['Contactos', datos.contactos.length], ['Garantías', todoCosto ? sistemasConGarantia.length : datos.contactos.filter((c) => Number(c.garantia_meses) > 0).length],
    ['Acabados', datos.acabados.length], ['Sistemas', datos.sistemas.length], ['Rutinas', datos.rutinas.length], ['Anexos', datos.anexos.length],
  ] : [];

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Manual de uso y mantenimiento</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre} · se entrega al cliente al finalizar la obra</p>
          </div>
          {m && (
            <div className="flex gap-2">
              {puedeEditar && <button onClick={preparar} disabled={trabajando} className="border border-carbon text-carbon px-3 py-2 rounded text-sm disabled:opacity-50">Actualizar directorio</button>}
              <button onClick={descargar} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">Descargar PDF</button>
            </div>
          )}
        </div>

        {mensaje && <p role="status" className="text-sm bg-hueso border border-gris-calido rounded p-3">{mensaje}</p>}

        {cargandoDatos ? <p className="text-sm text-neutral-500">Cargando…</p> : !m ? (
          <div className="bg-white rounded-lg shadow-sm border p-6 space-y-3 text-sm">
            <p>Esta obra aún no tiene manual.</p>
            <p className="text-neutral-600">Al prepararlo se crea con la plantilla base de HABITATUM (uso y mantenimiento por sistema y rutinas preventivas) y se importa el directorio de contratistas desde los contratos.</p>
            {puedeEditar && <button onClick={preparar} disabled={trabajando} className="bg-carbon text-hueso px-4 py-2 rounded disabled:opacity-50">{trabajando ? 'Preparando…' : 'Preparar manual'}</button>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {tarjetas.map(([k, v]) => (
                <div key={k} className="bg-white rounded border-t-2 border-dorado shadow-sm p-3">
                  <p className="text-[11px] uppercase tracking-wide text-neutral-500">{k}</p>
                  <p className="text-lg font-semibold">{v}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-2">
              <p className="font-medium">{pendientes.length ? 'Pendiente por completar' : 'El manual tiene la información básica completa.'}</p>
              {pendientes.length > 0 && (
                <ul className="list-disc pl-5 text-neutral-700 space-y-1">{pendientes.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
              <p className="text-xs text-neutral-500 pt-2">
                Para completarlo, envía la información al chat de esta obra (por ejemplo: “Acabados de la cocina: piso porcelanato … comprado en …”). El residente la guarda aquí y el PDF se actualiza solo.
              </p>
            </div>

            {todoCosto && (
              <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-2">
                <p className="font-medium">Todo costo: garantías y posventa a nombre de {responsable}</p>
                <p className="text-neutral-600">El PDF presenta las garantías por sistema y un solo contacto de posventa. Los teléfonos de los contratistas no salen en el PDF; el directorio de abajo queda como respaldo interno.</p>
                {sistemasConGarantia.length > 0 && (
                  <p className="text-neutral-700">Garantías: {sistemasConGarantia.map((x) => `${x.titulo} ${Number(x.garantia_meses)} meses`).join(' · ')}</p>
                )}
                {puedeEditar && (
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input type="checkbox" checked={mostrarContratistas} onChange={(ev) => cambiarMostrarContratistas(ev.target.checked)} />
                    Mostrar en el PDF las empresas participantes (solo empresa y actividad, sin teléfonos)
                  </label>
                )}
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
              <p className="px-4 pt-4 font-medium text-sm">Directorio{todoCosto ? ' (respaldo interno, no sale en el PDF con teléfonos)' : ''}</p>
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-left text-xs text-neutral-500 border-b">
                  <th className="p-3 font-medium">Actividad</th><th className="p-3 font-medium">Empresa</th><th className="p-3 font-medium">Teléfono</th><th className="p-3 font-medium">Garantía</th>
                </tr></thead>
                <tbody>
                  {datos.contactos.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="p-3">{c.actividad}</td><td className="p-3">{c.empresa}</td>
                      <td className={`p-3 ${c.telefono ? '' : 'text-red-600'}`}>{c.telefono || 'falta'}</td>
                      <td className="p-3">{Number(c.garantia_meses) > 0 ? `${Number(c.garantia_meses)} meses` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {datos.acabados.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
                <p className="px-4 pt-4 font-medium text-sm">Acabados</p>
                <table className="w-full text-sm min-w-[640px]">
                  <thead><tr className="text-left text-xs text-neutral-500 border-b">
                    <th className="p-3 font-medium">Espacio</th><th className="p-3 font-medium">Elemento</th><th className="p-3 font-medium">Material</th>
                    <th className="p-3 font-medium">Marca / referencia</th><th className="p-3 font-medium">Dónde comprar</th>
                  </tr></thead>
                  <tbody>
                    {datos.acabados.map((a) => (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="p-3">{a.espacio || 'General'}</td><td className="p-3">{a.elemento}</td><td className="p-3">{a.material}</td>
                        <td className="p-3">{[a.marca, a.referencia, a.color].filter(Boolean).join(' · ')}</td><td className="p-3">{a.donde_comprar}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
