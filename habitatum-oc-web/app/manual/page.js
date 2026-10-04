'use client';
import { useEffect, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import NavBar from '@/components/NavBar';

// ============================================================
// Manual de uso y mantenimiento (048–050). La pantalla es espejo del PDF:
// mismas secciones, mismo orden y mismas reglas por modelo de contratación.
// Todo se edita en el sitio y se guarda al salir del campo. Lo editado en una
// obra no cambia la plantilla base ni las demás obras. Nunca lleva precios.
// ============================================================

const FRECUENCIAS = [
  ['MENSUAL', 'Cada mes'], ['TRIMESTRAL', 'Cada tres meses'], ['SEMESTRAL', 'Cada seis meses'],
  ['ANUAL', 'Cada año'], ['CADA_2_ANOS', 'Cada dos años'], ['SEGUN_USO', 'Según el uso'],
];
const RESPONSABLES = [['PROPIETARIO', 'Propietario'], ['TECNICO', 'Técnico especializado']];

function fecha(f) {
  if (!f) return '—';
  const p = String(f).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f);
}
function sumarMeses(f, meses) {
  if (!f || !meses) return null;
  const d = new Date(`${String(f).slice(0, 10)}T00:00:00`);
  d.setMonth(d.getMonth() + Number(meses));
  return d.toISOString().slice(0, 10);
}

// Campo que se guarda al salir de él (solo si cambió).
function Campo({ valor, onGuardar, multilinea = false, tipo = 'text', placeholder = '', editable = true, className = '', filas = 3, etiqueta }) {
  const [v, setV] = useState(valor ?? '');
  useEffect(() => { setV(valor ?? ''); }, [valor]);
  if (!editable) {
    return <span className={`block px-2 py-1 whitespace-pre-wrap ${className}`}>{valor || <span className="text-neutral-400">—</span>}</span>;
  }
  const props = {
    value: v,
    'aria-label': etiqueta || placeholder,
    placeholder,
    onChange: (e) => setV(e.target.value),
    onBlur: () => { if (String(valor ?? '') !== String(v)) onGuardar(v); },
    className: `w-full rounded px-2 py-1 bg-transparent border border-transparent hover:border-gris-calido focus:border-dorado focus:bg-white outline-none ${className}`,
  };
  return multilinea ? <textarea rows={filas} {...props} /> : <input type={tipo} {...props} />;
}

function Seccion({ n, titulo, nota, children, accion }) {
  return (
    <section className="bg-white rounded-lg shadow-sm border p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 border-b-2 border-dorado pb-2">
        <div>
          <h2 className="text-lg font-semibold">{n ? <span className="text-dorado">{n}. </span> : null}{titulo}</h2>
          {nota && <p className="text-xs text-neutral-500 mt-0.5">{nota}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

const BOTON_AGREGAR = 'text-xs border border-dorado text-dorado px-2.5 py-1 rounded whitespace-nowrap hover:bg-hueso';
const BOTON_QUITAR = 'text-neutral-400 hover:text-red-600 px-1';

export default function ManualMantenimiento() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [datos, setDatos] = useState(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [guardado, setGuardado] = useState('');
  const editable = usuario?.rol === 'admin' || usuario?.rol === 'operativo';

  async function cargar(conIndicador = true) {
    if (conIndicador) setCargandoDatos(true);
    const s = crearClienteSupabase();
    const id = proyecto.id;
    const [man, con, aca, sis, rut, anx] = await Promise.all([
      s.from('manual_mantenimiento').select('*').eq('proyecto_id', id).maybeSingle(),
      s.from('manual_contactos').select('*').eq('proyecto_id', id).order('orden').order('empresa'),
      s.from('manual_acabados').select('*').eq('proyecto_id', id).order('espacio').order('orden'),
      s.from('manual_sistemas').select('*').eq('proyecto_id', id).order('orden'),
      s.from('manual_rutinas').select('*').eq('proyecto_id', id).order('orden'),
      s.from('manual_anexos').select('id, titulo, proveedor').eq('proyecto_id', id).order('orden'),
    ]);
    setDatos({ manual: man.data, contactos: con.data || [], acabados: aca.data || [], sistemas: sis.data || [], rutinas: rut.data || [], anexos: anx.data || [] });
    setCargandoDatos(false);
  }
  useEffect(() => { if (proyecto) cargar(); }, [proyecto]); // eslint-disable-line

  async function guardar(tabla, filtro, cambios) {
    setMensaje('');
    const s = crearClienteSupabase();
    let q = s.from(tabla).update(cambios);
    Object.entries(filtro).forEach(([k, v]) => { q = q.eq(k, v); });
    const { error } = await q;
    if (error) { setMensaje(`No se guardó: ${error.message}`); return; }
    setGuardado('Guardado'); setTimeout(() => setGuardado(''), 1500);
    cargar(false);
  }
  const guardarManual = (cambios) => guardar('manual_mantenimiento', { proyecto_id: proyecto.id }, cambios);
  const guardarFila = (tabla, id, cambios) => guardar(tabla, { id }, cambios);
  const numero = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  async function agregar(tabla, fila) {
    setMensaje('');
    const lista = { manual_contactos: datos.contactos, manual_acabados: datos.acabados, manual_sistemas: datos.sistemas, manual_rutinas: datos.rutinas }[tabla] || [];
    const orden = lista.reduce((m, x) => Math.max(m, Number(x.orden || 0)), 0) + 1;
    const { error } = await crearClienteSupabase().from(tabla).insert({ proyecto_id: proyecto.id, orden, ...fila });
    if (error) { setMensaje(`No se agregó: ${error.message}`); return; }
    cargar(false);
  }
  async function quitar(tabla, id, que) {
    if (!window.confirm(`¿Eliminar ${que}?`)) return;
    const { error } = await crearClienteSupabase().from(tabla).delete().eq('id', id);
    if (error) { setMensaje(`No se eliminó: ${error.message}`); return; }
    cargar(false);
  }

  async function preparar() {
    setTrabajando(true); setMensaje('');
    const { data, error } = await crearClienteSupabase().rpc('manual_inicializar', { p_proyecto: proyecto.id });
    setTrabajando(false);
    if (error) { setMensaje(error.message); return; }
    setMensaje(data?.plantilla_base
      ? `Manual preparado: plantilla base de HABITATUM y ${data.contactos_nuevos} contactos importados de los contratos.`
      : `Directorio actualizado: ${data?.contactos_nuevos || 0} contactos nuevos desde los contratos. Lo editado no cambió.`);
    cargar(false);
  }

  async function descargar() {
    setMensaje('');
    const ventana = window.open('', '_blank'); // se abre en el clic para que el iPhone no la bloquee
    const s = crearClienteSupabase();
    const { data: { session } } = await s.auth.getSession();
    const r = await fetch(`/api/manual/${proyecto.id}/pdf`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    if (!r.ok) { if (ventana) ventana.close(); setMensaje(await r.text()); return; }
    const url = URL.createObjectURL(await r.blob());
    if (ventana) ventana.location.href = url; else window.location.href = url;
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;
  const m = datos?.manual;

  // Mismas reglas que el PDF (lib/PlantillaManualPDF.js).
  const todoCosto = proyecto.modelo_contratacion === 'TODO_COSTO';
  const responsable = proyecto.mostrar_marca_habitatum === false ? (proyecto.nombre_emisor || 'el constructor') : 'HABITATUM';
  const mostrarContratistas = m ? (m.mostrar_contratistas ?? !todoCosto) : false;
  const contactosPdf = (datos?.contactos || []).filter((c) => c.mostrar_en_pdf !== false);
  const sistemasConGarantia = (datos?.sistemas || []).filter((x) => Number(x.garantia_meses) > 0);
  const contactosConGarantia = contactosPdf.filter((c) => Number(c.garantia_meses) > 0);
  const tituloDirectorio = todoCosto ? 'Participantes en la obra' : 'Directorio de contratistas y proveedores';
  const indice = [
    ...(mostrarContratistas ? [tituloDirectorio] : []), 'Garantías', 'Acabados y materiales',
    'Uso y mantenimiento por sistema', 'Rutinas de mantenimiento preventivo',
    ...(datos?.anexos?.length ? ['Anexos'] : []),
  ];
  const num = (t) => indice.indexOf(t) + 1;

  const pendientes = [];
  if (m) {
    if (!m.cliente || m.cliente === 'Reservado') pendientes.push('Nombre del cliente');
    if (!m.direccion) pendientes.push('Dirección del inmueble');
    if (!m.fecha_entrega) pendientes.push('Fecha de entrega (base de las garantías)');
    if (todoCosto) {
      if (!m.contacto_postventa) pendientes.push(`Contacto de posventa de ${responsable}`);
      if (!sistemasConGarantia.length) pendientes.push(`Garantías por sistema que da ${responsable}`);
    } else {
      const sinTel = contactosPdf.filter((c) => !c.telefono).map((c) => c.empresa);
      if (sinTel.length) pendientes.push(`Teléfono de: ${[...new Set(sinTel)].join(', ')}`);
      if (!contactosConGarantia.length) pendientes.push('Garantías de los contratistas');
    }
    if (!datos.acabados.length) pendientes.push('Acabados y materiales');
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Manual de uso y mantenimiento</h1>
            <p className="text-sm text-neutral-500">
              {proyecto.nombre} · {todoCosto ? `todo costo: garantías y posventa a nombre de ${responsable}` : 'administración delegada'}
              {guardado && <span className="ml-2 text-green-700">· {guardado}</span>}
            </p>
          </div>
          {m && (
            <div className="flex gap-2">
              {editable && <button onClick={preparar} disabled={trabajando} className="border border-carbon text-carbon px-3 py-2 rounded text-sm disabled:opacity-50">Actualizar directorio</button>}
              <button onClick={descargar} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">Descargar PDF</button>
            </div>
          )}
        </div>

        {mensaje && <p role="status" className="text-sm bg-hueso border border-gris-calido rounded p-3">{mensaje}</p>}

        {cargandoDatos ? <p className="text-sm text-neutral-500">Cargando…</p> : !m ? (
          <div className="bg-white rounded-lg shadow-sm border p-6 space-y-3 text-sm">
            <p>Esta obra aún no tiene manual.</p>
            <p className="text-neutral-600">Al prepararlo se crea con la plantilla base de HABITATUM (uso y mantenimiento por sistema y rutinas preventivas) y se importa el directorio de contratistas desde los contratos.</p>
            {editable && <button onClick={preparar} disabled={trabajando} className="bg-carbon text-hueso px-4 py-2 rounded disabled:opacity-50">{trabajando ? 'Preparando…' : 'Preparar manual'}</button>}
          </div>
        ) : (
          <>
            {pendientes.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-4 text-sm">
                <p className="font-medium mb-1">Pendiente por completar</p>
                <ul className="list-disc pl-5 space-y-0.5">{pendientes.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}

            {/* Portada */}
            <Seccion titulo="Portada" nota="Datos del inmueble y presentación, tal como salen en la primera página del PDF.">
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <label className="text-xs text-neutral-500 sm:col-span-1">Cliente
                  <Campo valor={m.cliente} editable={editable} onGuardar={(v) => guardarManual({ cliente: v || null })} /></label>
                <label className="text-xs text-neutral-500">Dirección
                  <Campo valor={m.direccion} editable={editable} onGuardar={(v) => guardarManual({ direccion: v || null })} /></label>
                <label className="text-xs text-neutral-500">Fecha de entrega
                  <Campo tipo="date" valor={m.fecha_entrega || ''} editable={editable} onGuardar={(v) => guardarManual({ fecha_entrega: v || null })} /></label>
                <label className="text-xs text-neutral-500">Contacto de posventa{todoCosto ? ` (${responsable})` : ''}
                  <Campo valor={m.contacto_postventa} placeholder="Nombre y teléfono" editable={editable} onGuardar={(v) => guardarManual({ contacto_postventa: v || null })} /></label>
              </div>
              {todoCosto && (
                <div className="bg-carbon text-hueso rounded p-3 text-sm">
                  <p className="text-[11px] uppercase tracking-wide text-dorado font-semibold">Posventa y garantías</p>
                  <p className="font-semibold">{m.contacto_postventa || responsable}</p>
                  <p className="text-xs text-gris-calido">Toda solicitud de garantía o posventa se tramita con {responsable}.</p>
                </div>
              )}
              <label className="block text-xs text-neutral-500">Presentación
                <Campo multilinea filas={4} valor={m.presentacion} editable={editable} onGuardar={(v) => guardarManual({ presentacion: v || null })} className="text-sm text-carbon" /></label>
              <div className="text-sm">
                <p className="text-xs text-neutral-500 mb-1">Contenido</p>
                <ol className="list-decimal pl-5 text-neutral-700">{indice.map((s) => <li key={s}>{s}</li>)}</ol>
              </div>
            </Seccion>

            {/* Directorio */}
            <Seccion
              n={mostrarContratistas ? num(tituloDirectorio) : null}
              titulo={todoCosto ? 'Contratistas (respaldo interno)' : tituloDirectorio}
              nota={todoCosto
                ? `En todo costo el PDF no muestra teléfonos ni correos. ${mostrarContratistas ? 'Las filas marcadas salen como "Participantes en la obra" (solo empresa y actividad).' : 'Esta sección no sale en el PDF.'}`
                : 'Solo las filas marcadas "Aparece en el PDF" se imprimen; las demás quedan como respaldo interno.'}
              accion={editable && <button className={BOTON_AGREGAR} onClick={() => agregar('manual_contactos', { empresa: 'Nuevo contacto', actividad: '' })}>+ Contacto</button>}
            >
              {todoCosto && editable && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={mostrarContratistas} onChange={(e) => guardarManual({ mostrar_contratistas: e.target.checked })} />
                  Mostrar en el PDF las empresas participantes (solo empresa y actividad)
                </label>
              )}
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="text-left text-xs text-neutral-500 border-b">
                    <th className="p-2 font-medium w-14 text-center">En PDF</th><th className="p-2 font-medium">Actividad</th><th className="p-2 font-medium">Empresa</th>
                    <th className="p-2 font-medium">Contacto</th><th className="p-2 font-medium w-32">Teléfono</th><th className="p-2 font-medium">Correo</th>
                    <th className="p-2 font-medium w-20">Garantía (meses)</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {datos.contactos.map((c) => (
                      <tr key={c.id} className={`border-b last:border-0 align-top ${c.mostrar_en_pdf === false ? 'opacity-50' : ''}`}>
                        <td className="p-2 text-center">
                          <input type="checkbox" aria-label={`Mostrar ${c.empresa} en el PDF`} disabled={!editable} checked={c.mostrar_en_pdf !== false}
                            onChange={(e) => guardarFila('manual_contactos', c.id, { mostrar_en_pdf: e.target.checked })} />
                        </td>
                        <td className="p-1"><Campo valor={c.actividad} editable={editable} onGuardar={(v) => guardarFila('manual_contactos', c.id, { actividad: v || null })} /></td>
                        <td className="p-1"><Campo valor={c.empresa} editable={editable} onGuardar={(v) => v && guardarFila('manual_contactos', c.id, { empresa: v })} className="font-medium" /></td>
                        <td className="p-1"><Campo valor={c.persona_contacto} editable={editable} onGuardar={(v) => guardarFila('manual_contactos', c.id, { persona_contacto: v || null })} /></td>
                        <td className="p-1"><Campo valor={c.telefono} editable={editable} onGuardar={(v) => guardarFila('manual_contactos', c.id, { telefono: v || null })} className={!c.telefono && !todoCosto ? 'placeholder:text-red-500' : ''} placeholder={todoCosto ? '' : 'falta'} /></td>
                        <td className="p-1"><Campo valor={c.correo} editable={editable} onGuardar={(v) => guardarFila('manual_contactos', c.id, { correo: v || null })} /></td>
                        <td className="p-1"><Campo tipo="number" valor={c.garantia_meses ?? ''} editable={editable} onGuardar={(v) => guardarFila('manual_contactos', c.id, { garantia_meses: numero(v) })} /></td>
                        <td className="p-1">{editable && <button className={BOTON_QUITAR} aria-label="Eliminar contacto" onClick={() => quitar('manual_contactos', c.id, `el contacto ${c.empresa}`)}>✕</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Seccion>

            {/* Garantías */}
            <Seccion n={num('Garantías')} titulo="Garantías"
              nota={todoCosto
                ? `Garantías otorgadas por ${responsable}, contadas desde la entrega (${fecha(m.fecha_entrega)}). Se editan por sistema.`
                : `De cada contratista marcado en el directorio, desde la entrega (${fecha(m.fecha_entrega)}). Los meses se editan en el directorio.`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead><tr className="text-left text-xs text-neutral-500 border-b">
                    <th className="p-2 font-medium">{todoCosto ? 'Sistema' : 'Actividad · responsable'}</th>
                    <th className="p-2 font-medium w-28">Meses</th><th className="p-2 font-medium w-28">Desde</th><th className="p-2 font-medium w-28">Hasta</th>
                  </tr></thead>
                  <tbody>
                    {todoCosto ? datos.sistemas.map((s) => (
                      <tr key={s.id} className={`border-b last:border-0 ${Number(s.garantia_meses) > 0 ? '' : 'text-neutral-400'}`}>
                        <td className="p-2">{s.titulo}</td>
                        <td className="p-1"><Campo tipo="number" valor={s.garantia_meses ?? ''} placeholder="sin garantía" editable={editable} onGuardar={(v) => guardarFila('manual_sistemas', s.id, { garantia_meses: numero(v) })} /></td>
                        <td className="p-2">{Number(s.garantia_meses) > 0 ? fecha(m.fecha_entrega) : '—'}</td>
                        <td className="p-2">{Number(s.garantia_meses) > 0 ? fecha(sumarMeses(m.fecha_entrega, s.garantia_meses)) : '—'}</td>
                      </tr>
                    )) : contactosConGarantia.map((c) => {
                      const desde = c.garantia_desde || m.fecha_entrega;
                      return (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="p-2">{c.actividad} · <span className="text-neutral-500">{c.empresa}</span></td>
                          <td className="p-2">{Number(c.garantia_meses)}</td>
                          <td className="p-2">{fecha(desde)}</td><td className="p-2">{fecha(c.garantia_hasta || sumarMeses(desde, c.garantia_meses))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {todoCosto && <p className="text-xs text-neutral-500 mt-1">Solo salen en el PDF los sistemas con meses de garantía.</p>}
              </div>
            </Seccion>

            {/* Acabados */}
            <Seccion n={num('Acabados y materiales')} titulo="Acabados y materiales"
              nota="Material, referencia y dónde comprarlo, para reponer o retocar con el mismo producto. El PDF los agrupa por espacio."
              accion={editable && <button className={BOTON_AGREGAR} onClick={() => agregar('manual_acabados', { espacio: 'General', elemento: 'Nuevo elemento' })}>+ Acabado</button>}>
              {datos.acabados.length === 0 ? <p className="text-sm text-neutral-400 italic">Pendiente por completar.</p> : (
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full text-sm min-w-[980px]">
                    <thead><tr className="text-left text-xs text-neutral-500 border-b">
                      <th className="p-2 font-medium w-28">Espacio</th><th className="p-2 font-medium w-32">Elemento</th><th className="p-2 font-medium">Material</th>
                      <th className="p-2 font-medium">Marca</th><th className="p-2 font-medium">Referencia</th><th className="p-2 font-medium w-28">Color</th>
                      <th className="p-2 font-medium">Dónde comprar</th><th className="p-2 font-medium">Cuidado</th><th className="w-8" />
                    </tr></thead>
                    <tbody>
                      {datos.acabados.map((a) => (
                        <tr key={a.id} className="border-b last:border-0 align-top">
                          {['espacio', 'elemento', 'material', 'marca', 'referencia', 'color', 'donde_comprar'].map((k) => (
                            <td key={k} className="p-1"><Campo valor={a[k]} editable={editable} className={k === 'elemento' ? 'font-medium' : ''}
                              onGuardar={(v) => (k === 'elemento' && !v) ? null : guardarFila('manual_acabados', a.id, { [k]: v || null })} /></td>
                          ))}
                          <td className="p-1"><Campo multilinea filas={2} valor={a.cuidado} editable={editable} onGuardar={(v) => guardarFila('manual_acabados', a.id, { cuidado: v || null })} /></td>
                          <td className="p-1">{editable && <button className={BOTON_QUITAR} aria-label="Eliminar acabado" onClick={() => quitar('manual_acabados', a.id, `el acabado ${a.elemento}`)}>✕</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Seccion>

            {/* Sistemas */}
            <Seccion n={num('Uso y mantenimiento por sistema')} titulo="Uso y mantenimiento por sistema"
              nota="Textos de la plantilla de HABITATUM, editables solo para esta obra."
              accion={editable && <button className={BOTON_AGREGAR} onClick={() => agregar('manual_sistemas', { sistema: `OTRO_${Date.now()}`, titulo: 'Nuevo sistema' })}>+ Sistema</button>}>
              <div className="space-y-3">
                {datos.sistemas.map((s) => (
                  <div key={s.id} className="border border-gris-calido rounded">
                    <div className="flex items-center gap-2 bg-hueso border-b-2 border-dorado px-2 py-1">
                      <Campo valor={s.titulo} editable={editable} className="font-semibold" onGuardar={(v) => v && guardarFila('manual_sistemas', s.id, { titulo: v })} />
                      {todoCosto && <span className="text-xs text-neutral-500 whitespace-nowrap">Garantía: {Number(s.garantia_meses) > 0 ? `${Number(s.garantia_meses)} meses` : 'sin garantía'}</span>}
                      {editable && <button className={BOTON_QUITAR} aria-label="Eliminar sistema" onClick={() => quitar('manual_sistemas', s.id, `el sistema ${s.titulo}`)}>✕</button>}
                    </div>
                    <div className="p-2 grid gap-1 text-sm">
                      {[['descripcion', 'Qué se instaló'], ['uso', 'Uso'], ['mantenimiento', 'Mantenimiento'], ['que_hacer', 'Qué hacer si falla']].map(([k, etq]) => (
                        <label key={k} className="block">
                          <span className="text-[11px] uppercase tracking-wide text-dorado font-semibold px-2">{etq}</span>
                          <Campo multilinea filas={k === 'descripcion' ? 2 : 3} valor={s[k]} editable={editable} etiqueta={`${etq} · ${s.titulo}`}
                            placeholder={k === 'descripcion' ? 'Equipos, marcas y especificaciones instaladas en esta obra' : ''}
                            onGuardar={(v) => guardarFila('manual_sistemas', s.id, { [k]: v || null })} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Seccion>

            {/* Rutinas */}
            <Seccion n={num('Rutinas de mantenimiento preventivo')} titulo="Rutinas de mantenimiento preventivo"
              nota="El PDF las agrupa por frecuencia."
              accion={editable && <button className={BOTON_AGREGAR} onClick={() => agregar('manual_rutinas', { sistema: datos.sistemas[0]?.sistema || 'GENERAL', tarea: 'Nueva tarea', frecuencia: 'ANUAL', responsable: 'PROPIETARIO' })}>+ Rutina</button>}>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm min-w-[680px]">
                  <thead><tr className="text-left text-xs text-neutral-500 border-b">
                    <th className="p-2 font-medium">Tarea</th><th className="p-2 font-medium w-48">Sistema</th>
                    <th className="p-2 font-medium w-40">Frecuencia</th><th className="p-2 font-medium w-44">Responsable</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {datos.rutinas.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="p-1"><Campo valor={r.tarea} editable={editable} onGuardar={(v) => v && guardarFila('manual_rutinas', r.id, { tarea: v })} /></td>
                        <td className="p-1">
                          <select disabled={!editable} value={r.sistema} onChange={(e) => guardarFila('manual_rutinas', r.id, { sistema: e.target.value })} className="w-full border rounded px-1 py-1 bg-white">
                            {!datos.sistemas.some((s) => s.sistema === r.sistema) && <option value={r.sistema}>{r.sistema}</option>}
                            {datos.sistemas.map((s) => <option key={s.id} value={s.sistema}>{s.titulo}</option>)}
                          </select>
                        </td>
                        <td className="p-1">
                          <select disabled={!editable} value={r.frecuencia} onChange={(e) => guardarFila('manual_rutinas', r.id, { frecuencia: e.target.value })} className="w-full border rounded px-1 py-1 bg-white">
                            {FRECUENCIAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                          </select>
                        </td>
                        <td className="p-1">
                          <select disabled={!editable} value={r.responsable} onChange={(e) => guardarFila('manual_rutinas', r.id, { responsable: e.target.value })} className="w-full border rounded px-1 py-1 bg-white">
                            {RESPONSABLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                          </select>
                        </td>
                        <td className="p-1">{editable && <button className={BOTON_QUITAR} aria-label="Eliminar rutina" onClick={() => quitar('manual_rutinas', r.id, 'esta rutina')}>✕</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Seccion>

            {datos.anexos.length > 0 && (
              <Seccion n={num('Anexos')} titulo="Anexos">
                <ul className="text-sm list-disc pl-5">{datos.anexos.map((a) => <li key={a.id}>{a.titulo}{a.proveedor ? ` · ${a.proveedor}` : ''}</li>)}</ul>
              </Seccion>
            )}
          </>
        )}
      </main>
    </div>
  );
}
