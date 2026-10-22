'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import { precargar, calcular, validar, valorEnLetras, defectoCampo, esTodoCosto, itemsDocumento, factorRegimen, normalizarAnexos } from '@/lib/documentoContrato';
import NavBar from '@/components/NavBar';

// ============================================================
// Documento del contrato estándar con contratista (059; todo costo desde la 067: plantilla propia, HABITATUM es el Contratante).
// Borrador → Generado (foto fija) → Firmado (escaneado subido, bloqueado). Solo admin edita.
// ============================================================

const CAMPO = 'border rounded px-3 py-2 text-sm w-full disabled:bg-neutral-50 disabled:text-neutral-600';
const ESTADOS = {
  BORRADOR: ['Borrador', 'bg-amber-100 text-amber-800'],
  GENERADO: ['Generado', 'bg-blue-100 text-blue-800'],
  FIRMADO: ['Firmado', 'bg-green-100 text-green-800'],
};
const TIPOS_ANEXO = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
const MAX_ANEXO = 20 * 1024 * 1024;
const PROPIETARIO_VACIO = { tipo_persona: 'NATURAL', nombre: '', identificacion: '', representante_legal: '', cc_representante: '', direccion: '', telefono: '', correo: '' };

function Seccion({ titulo, children, nota }) {
  return (
    <section className="bg-white rounded-lg border overflow-hidden">
      <h2 className="bg-carbon text-hueso text-xs font-semibold uppercase tracking-wide px-4 py-2">{titulo}</h2>
      <div className="p-4 space-y-3">
        {nota && <p className="text-[11px] text-neutral-500">{nota}</p>}
        {children}
      </div>
    </section>
  );
}

function Campo({ etiqueta, children, ayuda, ancho }) {
  return (
    <label className={`block ${ancho || ''}`}>
      <span className="text-[11px] text-neutral-500 block mb-1">{etiqueta}</span>
      {children}
      {ayuda && <span className="text-[11px] text-neutral-400 block mt-1">{ayuda}</span>}
    </label>
  );
}

export default function DocumentoContrato() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [datos, setDatos] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [archivoFirmado, setArchivoFirmado] = useState(null);

  async function cargar() {
    const { data, error: err } = await crearClienteSupabase().rpc('documento_contrato_datos', { p_contrato: id });
    if (err) { setError(err.message); return; }
    setDatos(data);
    setF(precargar(data));
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  const P = datos?.plantilla?.contenido;
  const esAdmin = usuario?.rol === 'admin';
  const estado = datos?.documento?.estado || null;
  const bloqueado = !esAdmin || estado === 'FIRMADO';
  const smmlv = Number(datos?.plantilla?.parametros?.smmlv) || null;
  const t = useMemo(() => (datos && f ? calcular(datos.items, f) : null), [datos, f]);
  const val = useMemo(() => (datos && f ? validar(datos, f, smmlv) : { errores: [], avisos: [] }), [datos, f, smmlv]);

  const setC = (k, v) => setF((x) => ({ ...x, campos: { ...x.campos, [k]: v } }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function token() {
    const { data: { session } } = await crearClienteSupabase().auth.getSession();
    return session?.access_token || '';
  }
  async function ejecutar(nombre, fn, ok) {
    setError(''); setAviso(''); setTrabajando(nombre);
    try { await fn(crearClienteSupabase()); if (ok) setAviso(ok); } catch (e) { setError(e.message || String(e)); }
    setTrabajando('');
  }
  function datosParaGuardar() {
    return {
      campos: f.campos, contratante: f.contratante, regimen: f.regimen,
      pct_a: Number(f.pct_a) || 0, pct_i: Number(f.pct_i) || 0, pct_u: Number(f.pct_u) || 0, pct_iva: Number(f.pct_iva) || 0,
      anticipo_pct: Number(f.anticipo_pct) || 0, retencion_pct: Number(f.retencion_pct) || 0,
      garantias: f.garantias.map((g) => ({ ...g, pct: Number(g.pct) || 0 })), obligaciones: f.obligaciones.filter((o) => String(o).trim()),
      fecha_firma: f.fecha_firma || null, referencias: f.referencias,
      precios_con_iva: !!f.precios_con_iva,
      anexos_integrales: normalizarAnexos(f.anexos_integrales).map((a) => ({ ...a, nombre: String(a.nombre || '').trim() }))
        .filter((a) => a.nombre || a.path),
    };
  }
  async function guardarBorrador(s) {
    const { data, error: err } = await s.rpc('guardar_documento_contrato', { p_contrato: id, p_datos: datosParaGuardar() });
    if (err) throw err;
    setDatos(data); setF(precargar(data));
  }
  const guardar = () => ejecutar('guardar', guardarBorrador, 'Borrador guardado.');
  function generar() {
    if (val.errores.length) { setError('No se puede generar todavía: revise la lista de datos obligatorios.'); return; }
    if (val.avisos.length && !window.confirm(`Advertencias:\n\n• ${val.avisos.join('\n• ')}\n\n¿Generar de todas formas?`)) return;
    ejecutar('generar', async (s) => {
      await guardarBorrador(s);
      const { data, error: err } = await s.rpc('generar_documento_contrato', { p_contrato: id });
      if (err) throw err;
      setDatos(data); setF(precargar(data));
      await compartirOAbrirArchivo(`/api/contratos/${id}/documento/pdf`, `Contrato ${datos.contrato.numero_contrato}.pdf`, { headers: { Authorization: `Bearer ${await token()}` } });
    }, 'Contrato generado: quedó guardada la foto fija del documento.');
  }
  async function vistaPrevia() {
    setError(''); setTrabajando('vista');
    await compartirOAbrirArchivo(`/api/contratos/${id}/documento/pdf`, `Vista previa ${datos.contrato.numero_contrato}.pdf`, {
      method: 'POST', body: JSON.stringify({ form: f }),
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    });
    setTrabajando('');
  }
  async function descargar() {
    setTrabajando('pdf');
    await compartirOAbrirArchivo(`/api/contratos/${id}/documento/pdf`, `Contrato ${datos.contrato.numero_contrato}.pdf`, { headers: { Authorization: `Bearer ${await token()}` } });
    setTrabajando('');
  }
  function marcarFirmado() {
    if (!archivoFirmado) { setError('Elija el PDF escaneado del contrato firmado.'); return; }
    if (!/\.pdf$/i.test(archivoFirmado.name)) { setError('El contrato firmado debe ser un PDF.'); return; }
    if (!window.confirm('¿Marcar el contrato como FIRMADO? Quedará bloqueado: ya no se podrá editar.')) return;
    ejecutar('firmar', async (s) => {
      const ruta = `${id}/firmado-${Date.now()}.pdf`;
      const { error: e1 } = await s.storage.from('contratos-firmados').upload(ruta, archivoFirmado, { contentType: 'application/pdf' });
      if (e1) throw e1;
      const { data, error: e2 } = await s.rpc('firmar_documento_contrato', { p_contrato: id, p_path: ruta });
      if (e2) throw e2;
      setDatos(data); setF(precargar(data)); setArchivoFirmado(null);
    }, 'Contrato marcado como firmado.');
  }
  async function verFirmado() {
    const { data, error: err } = await crearClienteSupabase().storage.from('contratos-firmados').createSignedUrl(datos.documento.firmado_path, 300);
    if (err) { setError(err.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  function guardarPropietariosEnProyecto() {
    if (!window.confirm('¿Guardar estos propietarios en la ficha del proyecto? Se usarán para los próximos contratos.')) return;
    ejecutar('prop', async (s) => {
      const { error: err } = await s.from('proyectos').update({ propietarios: f.contratante }).eq('id', datos.proyecto.id);
      if (err) throw err;
    }, 'Propietarios guardados en el proyecto.');
  }
  function guardarProveedor() {
    if (!window.confirm('¿Actualizar la ficha del proveedor con estos datos (identificación, teléfono, dirección, correo, tipo de persona)?')) return;
    const c = f.campos;
    ejecutar('prov', async (s) => {
      const { error: err } = await s.from('proveedores').update({
        nit: c.contratista_identificacion || null, telefono: c.contratista_telefono || null, direccion: c.contratista_direccion || null,
        correo: c.contratista_correo || null, tipo_persona: c.contratista_tipo_persona || 'NATURAL',
        representante_legal: c.contratista_rep_legal || null, cc_representante: c.contratista_cc_rep || null,
      }).eq('id', datos.proveedor.id);
      if (err) throw err;
    }, 'Ficha del proveedor actualizada.');
  }

  const setProp = (i, k, v) => set('contratante', f.contratante.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  const moverProp = (i, d) => { const l = [...f.contratante]; const [x] = l.splice(i, 1); l.splice(i + d, 0, x); set('contratante', l); };
  const setOblig = (i, v) => set('obligaciones', f.obligaciones.map((o, j) => (j === i ? v : o)));
  const moverOblig = (i, d) => { const l = [...f.obligaciones]; const [x] = l.splice(i, 1); l.splice(i + d, 0, x); set('obligaciones', l); };
  const setGar = (i, k, v) => set('garantias', f.garantias.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  const setAnexo = (i, cambios) => set('anexos_integrales', normalizarAnexos(f.anexos_integrales).map((a, j) => (j === i ? { ...a, ...cambios } : a)));
  function adjuntarAnexo(i, archivo) {
    if (!archivo) return;
    if (!TIPOS_ANEXO.includes(archivo.type)) { setError('El adjunto debe ser PDF, Excel, JPG o PNG.'); return; }
    if (archivo.size > MAX_ANEXO) { setError('El adjunto supera 20 MB.'); return; }
    ejecutar(`anexo${i}`, async (s) => {
      const limpio = archivo.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
      const ruta = `${id}/anexo-${Date.now()}-${limpio}`;
      const { error: err } = await s.storage.from('contratos-anexos').upload(ruta, archivo, { contentType: archivo.type });
      if (err) throw err;
      const actual = normalizarAnexos(f.anexos_integrales)[i] || {};
      setAnexo(i, { path: ruta, archivo: archivo.name, tipo: archivo.type, tamano: archivo.size,
        nombre: actual.nombre || archivo.name.replace(/\.[^.]+$/, '') });
    }, 'Archivo adjuntado. Guarde el borrador para que quede registrado.');
  }
  async function verAnexo(a) {
    const { data, error: err } = await crearClienteSupabase().storage.from('contratos-anexos').createSignedUrl(a.path, 300);
    if (err) { setError(err.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  const toggleRef = (itemId) => set('referencias', f.referencias.includes(itemId) ? f.referencias.filter((x) => x !== itemId) : [...f.referencias, itemId]);

  if (cargando || !usuario) return null;
  if (!datos || !f) {
    return (<div><NavBar usuario={usuario} proyecto={proyecto} /><main className="p-8 text-sm text-neutral-500">{error || 'Cargando...'}</main></div>);
  }
  if (!P) return (<div><NavBar usuario={usuario} proyecto={proyecto} /><main className="p-8 text-sm text-red-700">No hay plantilla de contrato vigente.</main></div>);

  const c = f.campos;
  const opciones = Object.fromEntries(P.garantias_exigidas.opciones.map((o) => [o.clave, o]));
  const [estTxt, estCls] = ESTADOS[estado] || ['Sin generar', 'bg-neutral-100 text-neutral-700'];
  const valorNucleo = Number(datos.contrato?.valor_inicial ?? NaN);
  const tc = esTodoCosto(datos);
  const fijo = P.contratante_fijo || {};
  const itemsDoc = itemsDocumento(datos.items || [], f);
  const n = (k) => (tc ? k - 1 : k); // en todo costo no hay sección "Administrador de obra"; se corre la numeración

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href={`/contratos/${id}`} className="text-xs text-neutral-500 hover:text-carbon">← Volver al contrato</Link>
            <h1 className="text-2xl font-semibold">Documento del contrato {datos.contrato.numero_contrato}</h1>
            <p className="text-sm text-neutral-500">
              Contrato estándar v{datos.plantilla.version} · <span className={`text-xs px-2 py-0.5 rounded ${estCls}`}>{estTxt}</span>
              {estado === 'GENERADO' && datos.documento?.generado_en && <span className="text-xs ml-2">foto fija del {String(datos.documento.generado_en).slice(0, 10)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={vistaPrevia} disabled={!!trabajando} className="border border-neutral-300 bg-white px-3 py-2 rounded text-sm disabled:opacity-50">
              {trabajando === 'vista' ? 'Generando…' : 'Vista previa PDF'}
            </button>
            {(estado === 'GENERADO' || estado === 'FIRMADO') && (
              <button type="button" onClick={descargar} disabled={!!trabajando} className="border border-neutral-300 bg-white px-3 py-2 rounded text-sm disabled:opacity-50">Descargar contrato</button>
            )}
            {estado === 'FIRMADO' && datos.documento?.firmado_path && (
              <button type="button" onClick={verFirmado} className="border border-green-300 text-green-800 bg-white px-3 py-2 rounded text-sm">Ver escaneado firmado</button>
            )}
            {!bloqueado && (
              <>
                <button type="button" onClick={guardar} disabled={!!trabajando} className="bg-dorado text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  {trabajando === 'guardar' ? 'Guardando…' : 'Guardar borrador'}
                </button>
                <button type="button" onClick={generar} disabled={!!trabajando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
                  {trabajando === 'generar' ? 'Generando…' : 'Generar contrato'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && <p role="alert" className="text-red-700 text-sm bg-red-50 border border-red-200 rounded p-3 whitespace-pre-line">{error}</p>}
        {aviso && <p className="text-green-800 text-sm bg-green-50 border border-green-200 rounded p-3">{aviso}</p>}
        {!esAdmin && <p className="text-xs text-neutral-600 bg-hueso border rounded p-3">Solo el administrador edita, genera y marca como firmado. Usted puede ver y descargar.</p>}
        {estado === 'FIRMADO' && <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded p-3">Contrato firmado: bloqueado. El PDF sale de la foto fija y no cambia aunque se editen el proyecto, el proveedor o la plantilla.</p>}
        {estado === 'GENERADO' && esAdmin && <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded p-3">Generado. Si guarda cambios vuelve a Borrador y debe generarlo otra vez. Cuando esté firmado, suba el escaneado abajo.</p>}

        {esAdmin && estado !== 'FIRMADO' && (val.errores.length > 0 || val.avisos.length > 0) && (
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            {val.errores.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-red-800">
                <p className="font-semibold mb-1">Obligatorio antes de generar</p>
                <ul className="list-disc pl-4 space-y-0.5">{val.errores.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            {val.avisos.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-900">
                <p className="font-semibold mb-1">Advertencias (dejan generar)</p>
                <ul className="list-disc pl-4 space-y-0.5">{val.avisos.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {tc ? (
          <Seccion titulo="1. Contratante (HABITATUM S.A.S. — firma por su representante legal)" nota="En las obras todo costo el Propietario no es parte del contrato ni firma. HABITATUM imparte las instrucciones, mide los cortes y recibe la obra. Razón social, teléfono y correo son fijos.">
            <div className="grid sm:grid-cols-3 gap-2">
              <Campo etiqueta="Razón social"><input disabled value={`${fijo.razon_social} – NIT ${fijo.nit}`} className={CAMPO} /></Campo>
              <Campo etiqueta="Representante legal *"><input disabled={bloqueado} value={c.contratante_rep_legal || ''} onChange={(e) => setC('contratante_rep_legal', e.target.value)} className={CAMPO} /></Campo>
              <Campo etiqueta="C.C. del representante legal *"><input disabled={bloqueado} value={c.contratante_cc_rep || ''} onChange={(e) => setC('contratante_cc_rep', e.target.value)} className={CAMPO} /></Campo>
              <Campo etiqueta="Teléfono"><input disabled value={fijo.telefono || ''} className={CAMPO} /></Campo>
              <Campo etiqueta="Correo"><input disabled value={fijo.correo || ''} className={CAMPO} /></Campo>
            </div>
          </Seccion>
        ) : (
        <Seccion titulo="1. Contratante (propietarios — firman el contrato)" nota="Se precargan desde la ficha del proyecto y se editan solo para este contrato. El primero es el propietario principal (dirección, teléfono y correo del cuadro).">
          {f.contratante.map((o, i) => (
            <div key={i} className="border rounded p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">Propietario {i + 1}{i === 0 ? ' · principal' : ''}</span>
                {!bloqueado && (
                  <span className="flex gap-1 text-xs">
                    <button type="button" disabled={i === 0} onClick={() => moverProp(i, -1)} className="border rounded px-2 disabled:opacity-30">↑</button>
                    <button type="button" disabled={i === f.contratante.length - 1} onClick={() => moverProp(i, 1)} className="border rounded px-2 disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => set('contratante', f.contratante.filter((_, j) => j !== i))} className="border border-red-200 text-red-700 rounded px-2">Quitar</button>
                  </span>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                <Campo etiqueta="Tipo de persona">
                  <select disabled={bloqueado} value={o.tipo_persona || 'NATURAL'} onChange={(e) => setProp(i, 'tipo_persona', e.target.value)} className={CAMPO}>
                    <option value="NATURAL">Natural</option><option value="JURIDICA">Jurídica</option>
                  </select>
                </Campo>
                <Campo etiqueta={o.tipo_persona === 'JURIDICA' ? 'Razón social *' : 'Nombre completo *'}><input disabled={bloqueado} value={o.nombre || ''} onChange={(e) => setProp(i, 'nombre', e.target.value)} className={CAMPO} /></Campo>
                <Campo etiqueta={o.tipo_persona === 'JURIDICA' ? 'NIT *' : 'Cédula *'}><input disabled={bloqueado} value={o.identificacion || ''} onChange={(e) => setProp(i, 'identificacion', e.target.value)} placeholder="70.166.074" className={CAMPO} /></Campo>
                {o.tipo_persona === 'JURIDICA' && (
                  <>
                    <Campo etiqueta="Representante legal"><input disabled={bloqueado} value={o.representante_legal || ''} onChange={(e) => setProp(i, 'representante_legal', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etiqueta="C.C. del representante"><input disabled={bloqueado} value={o.cc_representante || ''} onChange={(e) => setProp(i, 'cc_representante', e.target.value)} className={CAMPO} /></Campo>
                  </>
                )}
              </div>
            </div>
          ))}
          {!bloqueado && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set('contratante', [...f.contratante, { ...PROPIETARIO_VACIO }])} className="border border-dorado text-[#6b4a22] rounded px-3 py-1.5 text-sm">+ Agregar propietario</button>
              <button type="button" onClick={() => set('contratante', (datos.propietarios || []).map((o) => ({ ...o })))} className="border rounded px-3 py-1.5 text-sm">Cargar desde el proyecto</button>
              <button type="button" onClick={guardarPropietariosEnProyecto} className="border rounded px-3 py-1.5 text-sm">Guardar en la ficha del proyecto</button>
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-2 border-t pt-3">
            <Campo etiqueta="Dirección (opcional)"><input disabled={bloqueado} value={c.contratante_direccion || ''} onChange={(e) => setC('contratante_direccion', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Teléfono (opcional)"><input disabled={bloqueado} value={c.contratante_telefono || ''} onChange={(e) => setC('contratante_telefono', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Correo (opcional)"><input disabled={bloqueado} value={c.contratante_correo || ''} onChange={(e) => setC('contratante_correo', e.target.value)} className={CAMPO} /></Campo>
          </div>
        </Seccion>
        )}

        <Seccion titulo="2. Contratista" nota="Precargado desde el proveedor. Los campos opcionales vacíos no se imprimen.">
          <div className="grid sm:grid-cols-3 gap-2">
            <Campo etiqueta="Tipo de persona">
              <select disabled={bloqueado} value={c.contratista_tipo_persona || 'NATURAL'} onChange={(e) => setC('contratista_tipo_persona', e.target.value)} className={CAMPO}>
                <option value="NATURAL">Natural</option><option value="JURIDICA">Jurídica</option>
              </select>
            </Campo>
            <Campo etiqueta="Nombre / razón social *"><input disabled={bloqueado} value={c.contratista_nombre || ''} onChange={(e) => setC('contratista_nombre', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta={c.contratista_tipo_persona === 'JURIDICA' ? 'NIT *' : 'Cédula *'}><input disabled={bloqueado} value={c.contratista_identificacion || ''} onChange={(e) => setC('contratista_identificacion', e.target.value)} className={CAMPO} /></Campo>
            {c.contratista_tipo_persona === 'JURIDICA' && (
              <>
                <Campo etiqueta="Representante legal"><input disabled={bloqueado} value={c.contratista_rep_legal || ''} onChange={(e) => setC('contratista_rep_legal', e.target.value)} className={CAMPO} /></Campo>
                <Campo etiqueta="C.C. del representante"><input disabled={bloqueado} value={c.contratista_cc_rep || ''} onChange={(e) => setC('contratista_cc_rep', e.target.value)} className={CAMPO} /></Campo>
              </>
            )}
            <Campo etiqueta="Dirección (opcional)"><input disabled={bloqueado} value={c.contratista_direccion || ''} onChange={(e) => setC('contratista_direccion', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Teléfono (opcional)"><input disabled={bloqueado} value={c.contratista_telefono || ''} onChange={(e) => setC('contratista_telefono', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Correo (opcional)"><input disabled={bloqueado} value={c.contratista_correo || ''} onChange={(e) => setC('contratista_correo', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Régimen tributario y soporte de cobro" ancho="sm:col-span-2" ayuda='Ej.: "No responsable de IVA · Cuenta de cobro a nombre del Contratante"'>
              <input disabled={bloqueado} value={c.contratista_regimen || ''} onChange={(e) => setC('contratista_regimen', e.target.value)} className={CAMPO} />
            </Campo>
            <Campo etiqueta="Encargado permanente en obra (opcional)"><input disabled={bloqueado} value={c.encargado_obra || ''} onChange={(e) => setC('encargado_obra', e.target.value)} className={CAMPO} /></Campo>
          </div>
          {!bloqueado && <button type="button" onClick={guardarProveedor} className="border rounded px-3 py-1.5 text-sm">Actualizar ficha del proveedor</button>}
        </Seccion>

        {!tc && (
        <Seccion titulo="3. Administrador de obra (designado por el Contratante – no es parte)">
          <div className="grid sm:grid-cols-2 gap-2">
            <Campo etiqueta="Razón social"><input disabled value={defectoCampo(P, 'admin_razon_social')} className={CAMPO} /></Campo>
            <Campo etiqueta="Director de obra"><input disabled={bloqueado} value={c.admin_director || ''} onChange={(e) => setC('admin_director', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Teléfono"><input disabled value={defectoCampo(P, 'admin_telefono')} className={CAMPO} /></Campo>
            <Campo etiqueta="Correo"><input disabled value={defectoCampo(P, 'admin_correo')} className={CAMPO} /></Campo>
          </div>
        </Seccion>
        )}

        <Seccion titulo={`${n(4)}. Obra · ${n(5)}. Objeto y alcance`}>
          <div className="grid sm:grid-cols-2 gap-2">
            <Campo etiqueta="Proyecto *"><input disabled={bloqueado} value={c.proyecto_nombre || ''} onChange={(e) => setC('proyecto_nombre', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Ubicación *"><input disabled={bloqueado} value={c.proyecto_ubicacion || ''} onChange={(e) => setC('proyecto_ubicacion', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Actividad *" ancho="sm:col-span-2" ayuda={`El título del documento sale del concepto del contrato: "CONTRATO DE OBRA – ${String(datos.contrato.concepto || '').toUpperCase()}"`}>
              <input disabled={bloqueado} value={c.actividad || ''} onChange={(e) => setC('actividad', e.target.value)} className={CAMPO} />
            </Campo>
            <Campo etiqueta="Alcance *" ancho="sm:col-span-2" ayuda='Debe incluir "INCLUYE: …" y "NO INCLUYE: …" (materiales, equipos mayores, etc.)'>
              <textarea disabled={bloqueado} rows={5} value={c.alcance || ''} onChange={(e) => setC('alcance', e.target.value)} className={CAMPO} />
            </Campo>
            {tc && (
              <>
                <Campo etiqueta="Suministros del Contratante (opcional)" ancho="sm:col-span-2" ayuda="Qué entrega HABITATUM (materiales, equipos). Si se deja vacío no se imprime.">
                  <textarea disabled={bloqueado} rows={2} value={c.suministros_contratante || ''} onChange={(e) => setC('suministros_contratante', e.target.value)} className={CAMPO} />
                </Campo>
                <div className="sm:col-span-2 space-y-2">
                  <span className="text-[11px] text-neutral-500 block">Documentos que hacen parte integral (Cláusula 3) — ej.: pliego de condiciones, cuadro de precios aprobados. Los PDF e imágenes adjuntos se pegan al final del contrato; los Excel quedan solo para descarga (si quiere que vayan dentro del contrato, súbalos en PDF).</span>
                  {normalizarAnexos(f.anexos_integrales).map((a, i) => (
                    <div key={i} className="border rounded p-2 space-y-2">
                      <div className="flex gap-2 items-center">
                        <span className="text-sm font-semibold w-6">{i + 1}.</span>
                        <input disabled={bloqueado} value={a.nombre || ''} placeholder="Nombre del documento *" onChange={(e) => setAnexo(i, { nombre: e.target.value })} className={CAMPO} />
                        {!bloqueado && <button type="button" title="Quitar de la lista" onClick={() => set('anexos_integrales', normalizarAnexos(f.anexos_integrales).filter((_, j) => j !== i))} className="border border-red-200 text-red-700 rounded px-2 text-xs py-1">✕</button>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-8 text-xs">
                        {a.path ? (
                          <>
                            <button type="button" onClick={() => verAnexo(a)} className="underline text-carbon">📎 {a.archivo || 'Ver adjunto'}</button>
                            <span className="text-neutral-400">{a.tamano ? `${(a.tamano / 1048576).toFixed(1)} MB` : ''}{/excel|sheet/.test(a.tipo || '') ? ' · Excel: no se pega al PDF' : ''}</span>
                          </>
                        ) : <span className="text-neutral-400">Sin archivo adjunto</span>}
                        {!bloqueado && (
                          <label className="border rounded px-2 py-1 cursor-pointer bg-white">
                            {trabajando === `anexo${i}` ? 'Subiendo…' : a.path ? 'Reemplazar archivo' : 'Adjuntar archivo'}
                            <input type="file" className="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" disabled={!!trabajando}
                              onChange={(e) => { adjuntarAnexo(i, e.target.files?.[0]); e.target.value = ''; }} />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                  {!bloqueado && <button type="button" onClick={() => set('anexos_integrales', [...normalizarAnexos(f.anexos_integrales), { nombre: '' }])} className="border border-dorado text-[#6b4a22] rounded px-3 py-1.5 text-sm">+ Agregar documento</button>}
                </div>
              </>
            )}
          </div>
        </Seccion>

        <Seccion titulo={`${n(6)}. Condiciones económicas`}>
          <div className="grid sm:grid-cols-3 gap-2">
            <Campo etiqueta="Modalidad de precio"><input disabled value={defectoCampo(P, 'modalidad_precio')} className={CAMPO} /></Campo>
            <Campo etiqueta="Valor estimado del contrato (total Anexo 1)"><input disabled value={formatoPesos(t.total)} className={`${CAMPO} font-semibold`} /></Campo>
            <Campo etiqueta="Régimen tributario">
              <select disabled={bloqueado} value={f.regimen} onChange={(e) => set('regimen', e.target.value)} className={CAMPO}>
                <option value="SIN_IVA">Sin IVA</option><option value="IVA">IVA (sobre el subtotal)</option><option value="AIU">AIU (IVA solo sobre la U)</option>
                {(tc || f.regimen === 'IVA_UTILIDAD') && <option value="IVA_UTILIDAD">IVA sobre la utilidad</option>}
              </select>
            </Campo>
            <Campo etiqueta="Valor en letras" ancho="sm:col-span-3"><textarea disabled rows={2} value={valorEnLetras(t.total)} className={CAMPO} /></Campo>
            {f.regimen === 'AIU' && (
              <>
                <Campo etiqueta="Administración (A) %"><input disabled={bloqueado} type="number" step="any" value={f.pct_a} onChange={(e) => set('pct_a', e.target.value)} className={CAMPO} /></Campo>
                <Campo etiqueta="Imprevistos (I) %"><input disabled={bloqueado} type="number" step="any" value={f.pct_i} onChange={(e) => set('pct_i', e.target.value)} className={CAMPO} /></Campo>
                <Campo etiqueta="Utilidad (U) %"><input disabled={bloqueado} type="number" step="any" value={f.pct_u} onChange={(e) => set('pct_u', e.target.value)} className={CAMPO} /></Campo>
              </>
            )}
            {f.regimen === 'IVA_UTILIDAD' && (
              <Campo etiqueta="Utilidad gravable (U) %" ayuda="Base gravable = este % del subtotal; el IVA se cobra sobre esa base.">
                <input disabled={bloqueado} type="number" step="any" value={f.pct_u} onChange={(e) => set('pct_u', e.target.value)} className={CAMPO} />
              </Campo>
            )}
            {f.regimen !== 'SIN_IVA' && <Campo etiqueta="IVA %"><input disabled={bloqueado} type="number" step="any" value={f.pct_iva} onChange={(e) => set('pct_iva', e.target.value)} className={CAMPO} /></Campo>}
            {f.regimen !== 'SIN_IVA' && (
              <label className="sm:col-span-3 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" disabled={bloqueado} checked={!!f.precios_con_iva} onChange={(e) => set('precios_con_iva', e.target.checked)} />
                <span>Los valores unitarios del contrato ya incluyen el IVA
                  <span className="block text-[11px] text-neutral-500">El documento los presenta sin IVA (valor unitario ÷ {factorRegimen(f).toLocaleString('es-CO', { maximumFractionDigits: 6 })}) y el IVA aparte. No cambia los ítems ni los cortes.</span>
                </span>
              </label>
            )}
            <Campo etiqueta="Anticipo %"><input disabled={bloqueado} type="number" step="any" min="0" max="100" value={f.anticipo_pct} onChange={(e) => set('anticipo_pct', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Valor del anticipo"><input disabled value={Number(f.anticipo_pct) > 0 ? formatoPesos(t.anticipo) : 'Sin anticipo (no se imprime)'} className={CAMPO} /></Campo>
            <Campo etiqueta="Retención de garantía %"><input disabled={bloqueado} type="number" step="any" min="0" max="100" value={f.retencion_pct} onChange={(e) => set('retencion_pct', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Cortes y pagos" ancho="sm:col-span-3"><textarea disabled={bloqueado} rows={2} value={c.cortes_pagos || ''} onChange={(e) => setC('cortes_pagos', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Medio de pago" ancho="sm:col-span-3"><input disabled={bloqueado} value={c.medio_pago || ''} onChange={(e) => setC('medio_pago', e.target.value)} className={CAMPO} /></Campo>
          </div>
          {Number.isFinite(valorNucleo) && valorNucleo > 0 && Math.round(valorNucleo) !== t.total && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              El valor del contrato en la app es {formatoPesos(valorNucleo)}; el documento usa el total del Anexo 1 ({formatoPesos(t.total)}).
            </p>
          )}
        </Seccion>

        <Seccion titulo={`${n(7)}. Plazo y horario · ${n(8)}. Garantía de los trabajos · ${n(9)}. Firma y anexos`}>
          <div className="grid sm:grid-cols-2 gap-2">
            <Campo etiqueta="Plazo de ejecución *" ayuda='Ej.: "Siete (7) meses contados a partir de la firma del Contrato". Reemplace [N].'><input disabled={bloqueado} value={c.plazo || ''} onChange={(e) => setC('plazo', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Horario de la obra"><textarea disabled={bloqueado} rows={2} value={c.horario || ''} onChange={(e) => setC('horario', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Garantía de calidad"><input disabled={bloqueado} value={c.garantia || ''} onChange={(e) => setC('garantia', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Atención de reclamos"><input disabled={bloqueado} value={c.reclamos || ''} onChange={(e) => setC('reclamos', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Lugar de firma *"><input disabled={bloqueado} value={c.lugar_firma || ''} onChange={(e) => setC('lugar_firma', e.target.value)} placeholder="El Retiro, Antioquia" className={CAMPO} /></Campo>
            <Campo etiqueta="Fecha de firma *"><input disabled={bloqueado} type="date" value={f.fecha_firma || ''} onChange={(e) => set('fecha_firma', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Domicilio contractual (municipio)"><input disabled={bloqueado} value={c.domicilio || ''} onChange={(e) => setC('domicilio', e.target.value)} className={CAMPO} /></Campo>
            <Campo etiqueta="Anexos"><input disabled value={defectoCampo(P, 'anexos')} className={CAMPO} /></Campo>
          </div>
        </Seccion>

        <Seccion titulo="III. Garantías exigidas" nota="Valor asegurado = % × valor del contrato (anticipo: % × valor del anticipo). En el PDF solo salen las activas.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-left text-xs text-neutral-500">
                <tr><th className="p-2">Activa</th><th className="p-2">Amparo</th><th className="p-2 w-20">%</th><th className="p-2">Base</th><th className="p-2 text-right">Valor asegurado</th><th className="p-2">Vigencia</th></tr>
              </thead>
              <tbody>
                {f.garantias.map((g, i) => {
                  const o = opciones[g.clave];
                  const base = g.clave === 'anticipo' ? t.anticipo : t.total;
                  return (
                    <tr key={g.clave} className={`border-t ${g.activa ? '' : 'text-neutral-400'}`}>
                      <td className="p-2"><input type="checkbox" disabled={bloqueado} checked={g.activa} onChange={(e) => setGar(i, 'activa', e.target.checked)} /></td>
                      <td className="p-2">{o?.amparo}{o?.nota && <span className="block text-[11px] text-neutral-400">{o.nota}</span>}</td>
                      <td className="p-2"><input type="number" step="any" disabled={bloqueado} value={g.pct} onChange={(e) => setGar(i, 'pct', e.target.value)} className="border rounded px-2 py-1 w-16 text-right" /></td>
                      <td className="p-2 text-xs">{o?.base}</td>
                      <td className="p-2 text-right tabular-nums">{formatoPesos(Math.round(base * (Number(g.pct) || 0) / 100))}</td>
                      <td className="p-2"><input disabled={bloqueado} value={g.vigencia} onChange={(e) => setGar(i, 'vigencia', e.target.value)} className="border rounded px-2 py-1 w-full text-xs" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Seccion>

        <Seccion titulo="Anexo 1 · Ítems del contrato" nota={`Los ítems se editan en "Ítems del contrato". Marque como Referencia los precios sin cantidad contratada (horas, ítems por orden): van en la sección B y no suman al valor.${f.precios_con_iva ? ' Valores unitarios mostrados sin IVA.' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="text-left text-neutral-500">
                <tr><th className="p-2">Referencia</th><th className="p-2">Ítem</th><th className="p-2">Descripción</th><th className="p-2">Un</th><th className="p-2 text-right">Cant.</th><th className="p-2 text-right">V. unitario</th><th className="p-2 text-right">V. total</th></tr>
              </thead>
              <tbody>
                {itemsDoc.map((it) => {
                  const ref = f.referencias.includes(it.id);
                  return (
                    <tr key={it.id} className={`border-t ${ref ? 'bg-hueso/60' : ''}`}>
                      <td className="p-2"><input type="checkbox" disabled={bloqueado} checked={ref} onChange={() => toggleRef(it.id)} /></td>
                      <td className="p-2">{it.codigo}</td>
                      <td className="p-2 max-w-[360px]">{it.descripcion}</td>
                      <td className="p-2">{it.unidad}</td>
                      <td className="p-2 text-right">{ref ? '—' : Number(it.cantidad || 0).toLocaleString('es-CO')}</td>
                      <td className="p-2 text-right">{formatoPesos(it.valor_unitario)}</td>
                      <td className="p-2 text-right">{ref ? '—' : formatoPesos(Math.round(it.total))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t"><td colSpan={6} className="p-2 text-right">Subtotal</td><td className="p-2 text-right">{formatoPesos(t.subtotal)}</td></tr>
                {t.valor_aiu > 0 && <tr><td colSpan={6} className="p-2 text-right">A + I + U</td><td className="p-2 text-right">{formatoPesos(t.valor_aiu)}</td></tr>}
                {f.regimen === 'IVA_UTILIDAD' && <tr><td colSpan={6} className="p-2 text-right">Base gravable ({Number(f.pct_u) || 0} % del subtotal)</td><td className="p-2 text-right">{formatoPesos(t.base_gravable)}</td></tr>}
                {t.valor_iva > 0 && <tr><td colSpan={6} className="p-2 text-right">IVA</td><td className="p-2 text-right">{formatoPesos(t.valor_iva)}</td></tr>}
                <tr className="bg-carbon text-hueso font-semibold"><td colSpan={6} className="p-2 text-right">VALOR TOTAL DEL CONTRATO</td><td className="p-2 text-right">{formatoPesos(t.total)}</td></tr>
              </tfoot>
            </table>
          </div>
          <Link href={`/contratos/${id}/items`} className="text-xs underline">Editar ítems del contrato →</Link>
        </Seccion>

        <Seccion titulo="Anexo 2 · C. Obligaciones particulares de esta obra" nota={`Numeración continua después de las ${P.anexo_2.B_obligaciones_generales.length} obligaciones generales. Si no hay ninguna, la sección C no se imprime.`}>
          {f.obligaciones.map((o, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-sm font-semibold w-8 pt-2">{P.anexo_2.B_obligaciones_generales.length + i + 1}.</span>
              <textarea disabled={bloqueado} rows={2} value={o} onChange={(e) => setOblig(i, e.target.value)} className={CAMPO} />
              {!bloqueado && (
                <span className="flex flex-col gap-1 text-xs">
                  <button type="button" disabled={i === 0} onClick={() => moverOblig(i, -1)} className="border rounded px-2 disabled:opacity-30">↑</button>
                  <button type="button" disabled={i === f.obligaciones.length - 1} onClick={() => moverOblig(i, 1)} className="border rounded px-2 disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => set('obligaciones', f.obligaciones.filter((_, j) => j !== i))} className="border border-red-200 text-red-700 rounded px-2">✕</button>
                </span>
              )}
            </div>
          ))}
          {!bloqueado && <button type="button" onClick={() => set('obligaciones', [...f.obligaciones, ''])} className="border border-dorado text-[#6b4a22] rounded px-3 py-1.5 text-sm">+ Agregar obligación</button>}
        </Seccion>

        {esAdmin && estado === 'GENERADO' && (
          <Seccion titulo="Contrato firmado" nota="Suba el PDF escaneado con todas las firmas. Al marcarlo como firmado el contrato queda bloqueado.">
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => setArchivoFirmado(e.target.files?.[0] || null)} className="text-sm" />
              <button type="button" onClick={marcarFirmado} disabled={!!trabajando || !archivoFirmado} className="bg-green-700 text-white px-4 py-2 rounded text-sm disabled:opacity-40">
                {trabajando === 'firmar' ? 'Subiendo…' : 'Marcar como firmado'}
              </button>
            </div>
          </Seccion>
        )}
      </main>
    </div>
  );
}
