'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { TIPOS_CONTRATO, NOMBRES_TIPO_CONTRATO, plantillaClausulas, clausulasDelContrato } from '@/lib/plantillasContrato';
import { parseItemsExcel } from '@/lib/parseItemsContrato';
import NavBar from '@/components/NavBar';

function campoFormEdicion(contrato) {
  return {
    concepto: contrato.concepto || '',
    valor_inicial: contrato.valor_inicial || 0,
    tipo_contrato: contrato.tipo_contrato || 'SUMINISTRO_E_INSTALACION',
    clausulas: clausulasDelContrato(contrato),
    alcance_detallado: contrato.alcance_detallado || '',
    fecha_contrato: contrato.fecha_contrato || '',
    fecha_inicio: contrato.fecha_inicio || '',
    plazo_valor: contrato.plazo_valor || '',
    plazo_unidad: contrato.plazo_unidad || 'días calendario',
    garantia_meses: contrato.garantia_meses || '',
    incluye_anticipo: !!contrato.incluye_anticipo,
    pct_anticipo: contrato.pct_anticipo || 0,
    incluye_poliza_cumplimiento: !!contrato.incluye_poliza_cumplimiento,
    incluye_poliza_responsabilidad_civil: !!contrato.incluye_poliza_responsabilidad_civil,
    incluye_poliza_estabilidad: !!contrato.incluye_poliza_estabilidad,
    incluye_poliza_garantia: !!contrato.incluye_poliza_garantia,
    incluye_poliza_calidad: !!contrato.incluye_poliza_calidad,
    items_excel: Array.isArray(contrato.items_excel) ? contrato.items_excel : [],
  };
}

export default function DetalleContrato() {
  const { id } = useParams();
  const router = useRouter();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto } = useProyectoActual();
  const [contrato, setContrato] = useState(null);
  const [acumulados, setAcumulados] = useState(null);
  const [ordenes, setOrdenes] = useState([]);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [errorExcel, setErrorExcel] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [procesandoEstado, setProcesandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState('');

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: c } = await supabase.from('contratos').select('*, proveedores(nombre, nit, representante_legal, telefono)').eq('id', id).single();
    const { data: acum } = await supabase.from('v_acumulados_contrato').select('*').eq('contrato_id', id).single();
    const { data: oc } = await supabase.from('v_ordenes_compra_calculadas').select('*').eq('contrato_id', id).order('fecha');
    setContrato(c);
    setAcumulados(acum);
    setOrdenes(oc || []);
  }
  useEffect(() => {
    if (!usuario) return;
    cargar();
  }, [usuario]); // eslint-disable-line

  function abrirEdicion() {
    setForm(campoFormEdicion(contrato));
    setError('');
    setErrorExcel('');
    setEditando(true);
  }

  function cambiarTipoContrato(tipo) {
    setForm({ ...form, tipo_contrato: tipo, clausulas: plantillaClausulas(tipo) });
  }
  function cambiarClausula(idx, campo, valor) {
    setForm({ ...form, clausulas: form.clausulas.map((c, i) => (i === idx ? { ...c, [campo]: valor } : c)) });
  }

  // Importa el cuadro de ítems desde Excel (misma lógica flexible que en la
  // creación del contrato: no exige un formato exacto, ver lib/parseItemsContrato.js).
  function importarExcel(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorExcel('');
    const lector = new FileReader();
    lector.onload = (evento) => {
      try {
        const items = parseItemsExcel(evento.target.result);
        setForm((f) => ({ ...f, items_excel: items }));
      } catch (err) {
        setErrorExcel(err.message || 'No se pudo leer el archivo.');
      }
    };
    lector.readAsArrayBuffer(archivo);
    e.target.value = '';
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('contratos').update({
      concepto: form.concepto,
      valor_inicial: form.valor_inicial,
      tipo_contrato: form.tipo_contrato,
      clausulas: form.clausulas,
      alcance_detallado: form.alcance_detallado || null,
      fecha_contrato: form.fecha_contrato || null,
      fecha_inicio: form.fecha_inicio || null,
      plazo_valor: form.plazo_valor || null,
      plazo_unidad: form.plazo_unidad || null,
      garantia_meses: form.garantia_meses || null,
      incluye_anticipo: form.incluye_anticipo,
      pct_anticipo: form.pct_anticipo || 0,
      incluye_poliza_cumplimiento: form.incluye_poliza_cumplimiento,
      incluye_poliza_responsabilidad_civil: form.incluye_poliza_responsabilidad_civil,
      incluye_poliza_estabilidad: form.incluye_poliza_estabilidad,
      incluye_poliza_garantia: form.incluye_poliza_garantia,
      incluye_poliza_calidad: form.incluye_poliza_calidad,
      items_excel: form.items_excel,
    }).eq('id', id);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setEditando(false);
    cargar();
  }

  // Anular / reactivar: exclusivo de admin. El contrato anulado no se borra,
  // solo queda bloqueado (no se puede editar ni usarlo en Órdenes de Compra
  // nuevas) hasta que un admin lo reactive.
  async function alternarAnulado() {
    if (!contrato) return;
    const vaAAnular = contrato.estado !== 'ANULADO';
    const confirmacion = vaAAnular
      ? `¿Anular el contrato ${contrato.numero_contrato}? Quedará visible pero bloqueado: no se podrá editar ni usar en nuevas Órdenes de Compra hasta que se reactive.`
      : `¿Reactivar el contrato ${contrato.numero_contrato}?`;
    if (!window.confirm(confirmacion)) return;
    setProcesandoEstado(true);
    setErrorEstado('');
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase
      .from('contratos')
      .update({ estado: vaAAnular ? 'ANULADO' : 'VIGENTE' })
      .eq('id', id);
    setProcesandoEstado(false);
    if (err) { setErrorEstado(err.message); return; }
    cargar();
  }

  // Eliminar: borrado permanente, exclusivo de admin. Se bloquea desde el
  // cliente si el contrato ya tiene Órdenes de Compra asociadas (evita
  // romper el historial financiero por error); en ese caso se sugiere
  // anular en vez de eliminar.
  async function eliminarContrato() {
    if (!contrato) return;
    if (ordenes.length > 0) {
      window.alert(`Este contrato tiene ${ordenes.length} Orden(es) de Compra asociada(s). No se puede eliminar para no perder ese historial — anúlalo en su lugar.`);
      return;
    }
    if (!window.confirm(`¿Eliminar PERMANENTEMENTE el contrato ${contrato.numero_contrato}? Esta acción no se puede deshacer.`)) return;
    if (!window.confirm('Confirma de nuevo: se borrará el contrato para siempre. ¿Continuar?')) return;
    setProcesandoEstado(true);
    setErrorEstado('');
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('contratos').delete().eq('id', id);
    setProcesandoEstado(false);
    if (err) { setErrorEstado(err.message); return; }
    router.push('/contratos');
  }

  if (cargando || !usuario || !contrato) return null;

  const anulado = contrato.estado === 'ANULADO';
  const clausulasActuales = clausulasDelContrato(contrato);
  const items = Array.isArray(contrato.items_excel) ? contrato.items_excel : [];
  const totalItems = items.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
  const polizasActivas = [
    contrato.incluye_anticipo && `Anticipo (${contrato.pct_anticipo || 0}%)`,
    contrato.incluye_poliza_cumplimiento && 'Cumplimiento',
    contrato.incluye_poliza_responsabilidad_civil && 'Responsabilidad civil',
    contrato.incluye_poliza_estabilidad && 'Estabilidad',
    contrato.incluye_poliza_garantia && 'Garantía',
    contrato.incluye_poliza_calidad && 'Calidad',
  ].filter(Boolean);

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{contrato.numero_contrato}</h1>
            {anulado && (
              <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded">ANULADO</span>
            )}
          </div>
          <div className="flex gap-2">
            {usuario.rol !== 'lectura' && !editando && !anulado && (
              <button onClick={abrirEdicion} className="border px-4 py-2 rounded text-sm">Editar</button>
            )}
            <a href={`/api/contratos/${id}/pdf`} target="_blank" rel="noreferrer" className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              Descargar PDF
            </a>
            {usuario.rol === 'admin' && !editando && (
              <button
                onClick={alternarAnulado}
                disabled={procesandoEstado}
                className={`px-4 py-2 rounded text-sm border disabled:opacity-50 ${anulado ? '' : 'border-red-300 text-red-700 hover:bg-red-50'}`}
              >
                {procesandoEstado ? 'Procesando...' : anulado ? 'Reactivar' : 'Anular contrato'}
              </button>
            )}
            {usuario.rol === 'admin' && !editando && (
              <button
                onClick={eliminarContrato}
                disabled={procesandoEstado}
                className="px-4 py-2 rounded text-sm border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Eliminar
              </button>
            )}
          </div>
        </div>

        {errorEstado && <p className="text-red-600 text-sm">{errorEstado}</p>}
        {anulado && !editando && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            Este contrato está anulado: no se puede editar ni usar para nuevas Órdenes de Compra. Un administrador puede reactivarlo con el botón de arriba.
          </p>
        )}

        {!editando ? (
          <>
            <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-neutral-500">Contratista: </span>{contrato.proveedores?.nombre}</div>
              <div><span className="text-neutral-500">NIT: </span>{contrato.proveedores?.nit}</div>
              <div><span className="text-neutral-500">Concepto: </span>{contrato.concepto}</div>
              <div><span className="text-neutral-500">Valor inicial: </span>{formatoPesos(contrato.valor_inicial)}</div>
              <div><span className="text-neutral-500">Tipo de contrato: </span>{NOMBRES_TIPO_CONTRATO[contrato.tipo_contrato] || '-'}</div>
              <div><span className="text-neutral-500">Plazo: </span>{contrato.plazo_valor ? `${contrato.plazo_valor} ${contrato.plazo_unidad}` : '-'}</div>
              <div><span className="text-neutral-500">Fecha inicio: </span>{contrato.fecha_inicio || '-'}</div>
              <div><span className="text-neutral-500">Garantía: </span>{contrato.garantia_meses ? `${contrato.garantia_meses} meses` : '-'}</div>
              <div className="col-span-2"><span className="text-neutral-500">Pólizas: </span>{polizasActivas.length ? polizasActivas.join(', ') : 'Ninguna'}</div>
            </div>

            {items.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <h2 className="font-medium p-4 pb-0">Cuadro de ítems (informativo)</h2>
                <table className="w-full text-sm mt-2">
                  <thead className="bg-gris-calido/30 text-left">
                    <tr><th className="p-3">Descripción</th><th className="p-3">Unidad</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-right">Valor unitario</th><th className="p-3 text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-3">{it.descripcion}</td>
                        <td className="p-3">{it.unidad}</td>
                        <td className="p-3 text-right">{it.cantidad}</td>
                        <td className="p-3 text-right">{formatoPesos(it.valorUnitario)}</td>
                        <td className="p-3 text-right">{formatoPesos(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-medium"><td className="p-3" colSpan={4}>Total</td><td className="p-3 text-right">{formatoPesos(totalItems)}</td></tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-1">
              <h2 className="font-medium mb-2">Acumulados del contrato</h2>
              <div className="flex justify-between"><span>Subtotal acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados?.subtotal_acumulado)}</span></div>
              <div className="flex justify-between"><span>Total acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados?.total_acumulado)}</span></div>
              <div className="flex justify-between"><span>Retenido acumulado</span><span>{formatoPesos(acumulados?.retenido_acumulado)}</span></div>
              <div className="flex justify-between"><span>Amortizado acumulado</span><span>{formatoPesos(acumulados?.amortizado_acumulado)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-2 mt-2"><span>Devolución acumulada</span><span>{formatoPesos(acumulados?.devolucion_acumulada)}</span></div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <h2 className="font-medium p-4 pb-0">Órdenes de Compra del contrato</h2>
              <table className="w-full text-sm mt-2">
                <thead className="bg-gris-calido/30 text-left"><tr><th className="p-3">Folio</th><th className="p-3">Fecha</th><th className="p-3">Tipo pago</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">A Pagar</th></tr></thead>
                <tbody>
                  {ordenes.map((o) => (
                    <tr key={o.id} className="border-t">
                      <td className="p-3"><Link href={`/ordenes-compra/${o.id}`} className="text-blue-700 hover:underline">{o.folio}</Link></td>
                      <td className="p-3">{o.fecha}</td>
                      <td className="p-3">{o.tipo_pago}</td>
                      <td className="p-3 text-right">{formatoPesos(o.total)}</td>
                      <td className="p-3 text-right">{formatoPesos(o.neto_a_pagar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details className="bg-white rounded-lg shadow-sm border p-5">
              <summary className="text-sm font-medium cursor-pointer">Cláusulas del contrato</summary>
              <div className="mt-3 space-y-3 text-sm">
                {clausulasActuales.map((cl) => (
                  <div key={cl.id}>
                    <p className="font-medium">{cl.titulo}</p>
                    <p className="text-neutral-600">{cl.texto}</p>
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          <form onSubmit={guardarEdicion} className="bg-white border rounded-lg p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Concepto" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className="border rounded px-3 py-2 text-sm" />
              <input type="number" placeholder="Valor inicial" value={form.valor_inicial} onChange={(e) => setForm({ ...form, valor_inicial: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">Tipo de contrato</label>
              <select value={form.tipo_contrato} onChange={(e) => cambiarTipoContrato(e.target.value)} className="border rounded px-3 py-2 text-sm w-full">
                {TIPOS_CONTRATO.map((t) => <option key={t} value={t}>{NOMBRES_TIPO_CONTRATO[t]}</option>)}
              </select>
              <p className="text-[11px] text-neutral-400 mt-1">Cambiar el tipo reemplaza el texto de las cláusulas por la plantilla del nuevo tipo.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Fecha del contrato</label>
                <input type="date" value={form.fecha_contrato} onChange={(e) => setForm({ ...form, fecha_contrato: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Fecha de inicio</label>
                <input type="date" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <div className="flex gap-2">
                <input type="number" placeholder="Plazo" value={form.plazo_valor} onChange={(e) => setForm({ ...form, plazo_valor: e.target.value })} className="border rounded px-3 py-2 text-sm w-1/2" />
                <select value={form.plazo_unidad} onChange={(e) => setForm({ ...form, plazo_unidad: e.target.value })} className="border rounded px-3 py-2 text-sm w-1/2">
                  <option value="días calendario">días calendario</option>
                  <option value="días hábiles">días hábiles</option>
                  <option value="semanas">semanas</option>
                  <option value="meses">meses</option>
                </select>
              </div>
              <input type="number" placeholder="Garantía (meses)" value={form.garantia_meses} onChange={(e) => setForm({ ...form, garantia_meses: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            </div>

            <div className="border-t pt-3">
              <label className="block text-xs text-neutral-500 mb-1">Alcance detallado</label>
              <textarea value={form.alcance_detallado} onChange={(e) => setForm({ ...form, alcance_detallado: e.target.value })} rows={3} className="border rounded px-3 py-2 text-sm w-full" />
            </div>

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-neutral-500 font-medium">Pólizas y anticipo</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_anticipo} onChange={(e) => setForm({ ...form, incluye_anticipo: e.target.checked })} />
                Anticipo
                {form.incluye_anticipo && (
                  <input type="number" placeholder="% del valor" value={form.pct_anticipo} onChange={(e) => setForm({ ...form, pct_anticipo: e.target.value })} className="border rounded px-2 py-1 text-sm w-24 ml-2" />
                )}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_cumplimiento} onChange={(e) => setForm({ ...form, incluye_poliza_cumplimiento: e.target.checked })} />
                Póliza de cumplimiento
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_responsabilidad_civil} onChange={(e) => setForm({ ...form, incluye_poliza_responsabilidad_civil: e.target.checked })} />
                Póliza de responsabilidad civil
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_estabilidad} onChange={(e) => setForm({ ...form, incluye_poliza_estabilidad: e.target.checked })} />
                Póliza de estabilidad
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_garantia} onChange={(e) => setForm({ ...form, incluye_poliza_garantia: e.target.checked })} />
                Póliza de garantía
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_calidad} onChange={(e) => setForm({ ...form, incluye_poliza_calidad: e.target.checked })} />
                Póliza de calidad
              </label>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-neutral-500 font-medium mb-1">Cuadro de ítems (importado de Excel — informativo)</p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={importarExcel} className="text-sm" />
              <p className="text-[11px] text-neutral-400 mt-1">
                No tiene que ser un formato exacto: se reconocen encabezados parecidos a Descripción, Unidad (opcional), Cantidad y Valor unitario aunque el archivo traiga columnas de más o esté abreviado.
              </p>
              {errorExcel && <p className="text-red-600 text-xs mt-1">{errorExcel}</p>}
              {form.items_excel.length > 0 && (
                <div className="mt-2 border rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gris-calido/30 text-left">
                      <tr><th className="p-2">Descripción</th><th className="p-2">Unidad</th><th className="p-2 text-right">Cantidad</th><th className="p-2 text-right">Valor unitario</th><th className="p-2 text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {form.items_excel.map((it, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{it.descripcion}</td>
                          <td className="p-2">{it.unidad}</td>
                          <td className="p-2 text-right">{it.cantidad}</td>
                          <td className="p-2 text-right">{formatoPesos(it.valorUnitario)}</td>
                          <td className="p-2 text-right">{formatoPesos(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" onClick={() => setForm({ ...form, items_excel: [] })} className="text-xs text-red-600 underline p-2">Quitar cuadro importado</button>
                </div>
              )}
            </div>

            <details className="border-t pt-3">
              <summary className="text-xs text-neutral-500 font-medium cursor-pointer">Cláusulas del contrato</summary>
              <div className="space-y-3 mt-3">
                {form.clausulas.map((cl, i) => (
                  <div key={cl.id}>
                    <input value={cl.titulo} onChange={(e) => cambiarClausula(i, 'titulo', e.target.value)} className="border rounded px-2 py-1 text-xs font-medium w-full mb-1" />
                    <textarea value={cl.texto} onChange={(e) => cambiarClausula(i, 'texto', e.target.value)} rows={2} className="border rounded px-2 py-1 text-xs w-full" />
                  </div>
                ))}
              </div>
            </details>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">{guardando ? 'Guardando...' : 'Guardar cambios'}</button>
              <button type="button" onClick={() => setEditando(false)} className="px-4 py-2 rounded text-sm border">Cancelar</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
