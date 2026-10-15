'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';
import SeccionCortes from '@/lib/SeccionCortes';

// 059: la capa DOCUMENTO del contrato (tipo, cláusulas, pólizas, cuadro Excel, plazo, garantía y su PDF)
// se reemplazó por el Documento del contrato estándar v1.0 (/contratos/[id]/documento). Aquí solo
// se edita el núcleo del contrato.
function campoFormEdicion(contrato) {
  return {
    concepto: contrato.concepto || '',
    valor_inicial: contrato.valor_inicial || 0,
    alcance_detallado: contrato.alcance_detallado || '',
    fecha_contrato: contrato.fecha_contrato || '',
    fecha_inicio: contrato.fecha_inicio || '',
    incluye_anticipo: !!contrato.incluye_anticipo,
    pct_anticipo: contrato.pct_anticipo || 0,
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
  const [guardando, setGuardando] = useState(false);
  const [procesandoEstado, setProcesandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState('');

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: c } = await supabase.from('contratos').select('*, proveedores(nombre, nit, representante_legal, telefono), proyectos(modelo_contratacion), contrato_documentos(estado)').eq('id', id).single();
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
    setEditando(true);
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('contratos').update({
      concepto: form.concepto,
      valor_inicial: form.valor_inicial,
      alcance_detallado: form.alcance_detallado || null,
      fecha_contrato: form.fecha_contrato || null,
      fecha_inicio: form.fecha_inicio || null,
      incluye_anticipo: form.incluye_anticipo,
      pct_anticipo: form.pct_anticipo || 0,
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
  const todoCosto = contrato.proyectos?.modelo_contratacion === 'TODO_COSTO';
  const estadoDoc = (Array.isArray(contrato.contrato_documentos) ? contrato.contrato_documentos[0] : contrato.contrato_documentos)?.estado;
  const ETIQUETA_DOC = { BORRADOR: 'Borrador', GENERADO: 'Generado', FIRMADO: 'Firmado' };

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{contrato.numero_contrato}</h1>
            {anulado && (
              <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded">ANULADO</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {usuario.rol !== 'lectura' && !editando && !anulado && (
              <button onClick={abrirEdicion} className="border px-4 py-2 rounded text-sm">Editar</button>
            )}
            {todoCosto ? (
              <span title="Formato todo costo pendiente" className="bg-neutral-200 text-neutral-500 px-4 py-2 rounded text-sm cursor-not-allowed">
                Documento del contrato · Formato todo costo pendiente
              </span>
            ) : (
              <Link href={`/contratos/${id}/documento`} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
                Documento del contrato{estadoDoc ? ` · ${ETIQUETA_DOC[estadoDoc]}` : ''}
              </Link>
            )}
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
              <div><span className="text-neutral-500">Fecha inicio: </span>{contrato.fecha_inicio || '-'}</div>
              <div><span className="text-neutral-500">Anticipo: </span>{contrato.incluye_anticipo ? `${contrato.pct_anticipo || 0}%` : 'No'}</div>
            </div>

            <SeccionCortes contrato={contrato} usuario={usuario} />

            <div className="bg-white rounded-lg shadow-sm border p-5 text-sm space-y-1">
              <h2 className="font-medium mb-2">Acumulados del contrato</h2>
              <div className="flex justify-between"><span>Subtotal acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados?.subtotal_acumulado)}</span></div>
              <div className="flex justify-between"><span>Total acumulado (excluye anticipos)</span><span>{formatoPesos(acumulados?.total_acumulado)}</span></div>
              <div className="flex justify-between"><span>Retenido acumulado</span><span>{formatoPesos(acumulados?.retenido_acumulado)}</span></div>
              <div className="flex justify-between"><span>Amortizado acumulado</span><span>{formatoPesos(acumulados?.amortizado_acumulado)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-2 mt-2"><span>Devolución acumulada</span><span>{formatoPesos(acumulados?.devolucion_acumulada)}</span></div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
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

          </>
        ) : (
          <form onSubmit={guardarEdicion} className="bg-white border rounded-lg p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Concepto" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className="border rounded px-3 py-2 text-sm" />
              <input type="number" placeholder="Valor inicial" value={form.valor_inicial} onChange={(e) => setForm({ ...form, valor_inicial: e.target.value })} className="border rounded px-3 py-2 text-sm" />
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
            </div>

            <div className="border-t pt-3">
              <label className="block text-xs text-neutral-500 mb-1">Alcance detallado</label>
              <textarea value={form.alcance_detallado} onChange={(e) => setForm({ ...form, alcance_detallado: e.target.value })} rows={3} className="border rounded px-3 py-2 text-sm w-full" />
            </div>

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-neutral-500 font-medium">Anticipo (las garantías y el texto del contrato se manejan en Documento del contrato)</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_anticipo} onChange={(e) => setForm({ ...form, incluye_anticipo: e.target.checked })} />
                Anticipo
                {form.incluye_anticipo && (
                  <input type="number" placeholder="% del valor" value={form.pct_anticipo} onChange={(e) => setForm({ ...form, pct_anticipo: e.target.value })} className="border rounded px-2 py-1 text-sm w-24 ml-2" />
                )}
              </label>
            </div>

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
