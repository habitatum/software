'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

// ============================================================
// Ítems del contrato (alcance para cortes de obra).
// - Se pueden importar del "Cuadro de ítems" del contrato (Excel cargado al crearlo).
// - "Código ppto" enlaza el ítem al presupuesto: "7.04" = ítem; "7" = capítulo.
//   Así cada corte se imputa solo al control presupuestal.
// ============================================================

const CAMPO = 'border rounded px-2 py-1 text-sm w-full';
const nuevaFila = (es_adicional = false) => ({ id: null, codigo: '', descripcion: '', unidad: '', cantidad: '', valor_unitario: '', es_adicional, nuevo: true });
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export default function ItemsContrato() {
  const { id } = useParams();
  const router = useRouter();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [contrato, setContrato] = useState(null);
  const [filas, setFilas] = useState([]);
  const [usados, setUsados] = useState(new Set());
  const [borrados, setBorrados] = useState([]);
  const [ppto, setPpto] = useState({ caps: [], items: [] });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [avisoImportacion, setAvisoImportacion] = useState('');
  const puedeEditar = usuario?.rol === 'admin' || usuario?.rol === 'operativo';

  useEffect(() => {
    if (!usuario || !proyecto) return;
    (async () => {
      const s = crearClienteSupabase();
      const [{ data: k }, { data: its }, { data: pres }] = await Promise.all([
        s.from('contratos').select('*, proveedores:contratista_id(nombre)').eq('id', id).single(),
        s.from('contrato_items').select('*').eq('contrato_id', id).order('es_adicional').order('orden'),
        s.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
      ]);
      setContrato(k);
      setFilas((its || []).map((i) => ({ ...i, cantidad: i.cantidad ?? '', valor_unitario: i.valor_unitario ?? '' })));
      const ids = (its || []).map((i) => i.id);
      if (ids.length) {
        const { data: ci } = await s.from('corte_items').select('contrato_item_id').in('contrato_item_id', ids);
        setUsados(new Set((ci || []).map((x) => x.contrato_item_id)));
      }
      if (pres) {
        const { data: caps } = await s.from('presupuesto_capitulos').select('id, codigo, nombre').eq('presupuesto_id', pres.id);
        const { data: items } = await s.from('presupuesto_items').select('id, codigo, capitulo_id').in('capitulo_id', (caps || []).map((c) => c.id));
        setPpto({ caps: caps || [], items: items || [] });
      }
    })();
  }, [usuario, proyecto, id]);

  function importarDelCuadro() {
    const cuadro = contrato?.items_excel || [];
    if (!cuadro.length) return;
    // El cuadro trae títulos de capítulo (sin cantidad ni valor) e ítems en $0
    // (ej. "incluido"): no se pueden cortar ni pagar, así que no se importan.
    const conValor = cuadro.filter((x) => Number(x.valorUnitario ?? x.valor_unitario ?? 0) > 0);
    const omitidos = cuadro.length - conValor.length;
    setAvisoImportacion(omitidos > 0
      ? `Se importaron ${conValor.length} ítems. Se omitieron ${omitidos} filas sin valor unitario (títulos de capítulo o ítems en $0). Escribe el código del presupuesto de cada ítem antes de guardar.`
      : `Se importaron ${conValor.length} ítems. Escribe el código del presupuesto de cada ítem antes de guardar.`);
    setFilas([...filas, ...conValor.map((x) => ({
      ...nuevaFila(false), descripcion: x.descripcion || '', unidad: x.unidad || '',
      cantidad: x.cantidad ?? '', valor_unitario: x.valorUnitario ?? x.valor_unitario ?? '',
    }))]);
  }

  function enlace(codigo) {
    const c = String(codigo || '').trim();
    if (!c) return { presupuesto_item_id: null, capitulo_id: null, ok: true };
    const it = ppto.items.find((i) => i.codigo === c);
    if (it) return { presupuesto_item_id: it.id, capitulo_id: it.capitulo_id, ok: true };
    const cap = ppto.caps.find((x) => String(x.codigo).replace(/^0+(?=\d)/, '') === c.split('.')[0].replace(/^0+(?=\d)/, '') && !c.includes('.'));
    if (cap) return { presupuesto_item_id: null, capitulo_id: cap.id, ok: true };
    return { presupuesto_item_id: null, capitulo_id: null, ok: false };
  }

  async function guardar() {
    setError('');
    const validas = filas.filter((f) => f.descripcion.trim());
    const malCodigo = validas.filter((f) => !enlace(f.codigo).ok);
    if (malCodigo.length) { setError(`Código de presupuesto no encontrado: ${malCodigo.map((f) => f.codigo).join(', ')}. Usa el código de un ítem (7.04) o de un capítulo (7).`); return; }
    if (validas.some((f) => !f.es_adicional && !(Number(f.cantidad) > 0))) { setError('Los ítems del contrato necesitan cantidad contratada.'); return; }
    if (validas.some((f) => !(Number(f.valor_unitario) > 0))) { setError('Todos los ítems necesitan valor unitario.'); return; }
    setGuardando(true);
    try {
      const s = crearClienteSupabase();
      if (borrados.length) {
        const { error: e } = await s.from('contrato_items').delete().in('id', borrados);
        if (e) throw e;
      }
      let orden = 0;
      for (const f of validas) {
        const { presupuesto_item_id, capitulo_id } = enlace(f.codigo);
        const fila = {
          contrato_id: id, codigo: String(f.codigo || '').trim() || null, descripcion: f.descripcion.trim(), unidad: f.unidad || null,
          cantidad: f.es_adicional ? num(f.cantidad) : Number(f.cantidad), valor_unitario: Number(f.valor_unitario),
          es_adicional: !!f.es_adicional, presupuesto_item_id, capitulo_id, orden: orden++,
        };
        const { error: e } = f.id ? await s.from('contrato_items').update(fila).eq('id', f.id) : await s.from('contrato_items').insert(fila);
        if (e) throw e;
      }
      router.push(`/contratos/${id}`);
    } catch (e) { setError(e.message); }
    setGuardando(false);
  }

  function quitar(k) {
    const f = filas[k];
    if (f.id && usados.has(f.id)) { setError('Ese ítem ya tiene cantidades en cortes; no se puede eliminar.'); return; }
    if (f.id) setBorrados([...borrados, f.id]);
    setFilas(filas.filter((_, j) => j !== k));
  }

  const set = (k, campo, valor) => { const x = [...filas]; x[k] = { ...x[k], [campo]: valor }; setFilas(x); };
  const total = filas.filter((f) => !f.es_adicional).reduce((a, f) => a + (Number(f.cantidad) || 0) * (Number(f.valor_unitario) || 0), 0);

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-6xl mx-auto space-y-4">
        <Link href={`/contratos/${id}`} className="text-sm text-neutral-500">← Volver al contrato</Link>
        {!contrato ? <p className="text-sm text-neutral-500">Cargando…</p> : (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Ítems del contrato {contrato.numero_contrato}</h1>
              <p className="text-sm text-neutral-500">{contrato.proveedores?.nombre} · {contrato.concepto} · Valor del contrato {formatoPesos(contrato.valor_inicial)}</p>
            </div>
            <div className="bg-hueso rounded-lg p-3 text-xs text-neutral-600">
              Estos ítems son la base de los cortes de obra: en cada corte solo se escriben las cantidades ejecutadas.
              En <strong>Código ppto</strong> escribe el código del ítem del presupuesto (ej. <em>7.04</em>) o el del capítulo (ej. <em>7</em>) para que cada corte se impute solo al control presupuestal.
            </div>
            {avisoImportacion && <p role="status" className="text-amber-900 text-sm bg-amber-50 border border-amber-200 rounded p-3">{avisoImportacion}</p>}
            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}
            {filas.length === 0 && (contrato.items_excel || []).length > 0 && puedeEditar && (
              <button onClick={importarDelCuadro} className="border border-dorado text-dorado px-4 py-2 rounded text-sm">
                Importar los {contrato.items_excel.length} ítems del cuadro del contrato
              </button>
            )}
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gris-calido/30 text-left text-xs">
                  <tr><th className="p-2 w-24">Código ppto</th><th className="p-2">Descripción</th><th className="p-2 w-20">Und</th><th className="p-2 w-28 text-right">Cant. contratada</th><th className="p-2 w-32 text-right">Vr. unitario</th><th className="p-2 w-32 text-right">Subtotal</th><th className="p-2 w-20">Adicional</th><th className="p-2 w-16" /></tr>
                </thead>
                <tbody>
                  {filas.map((f, k) => (
                    <tr key={f.id || `n${k}`} className="border-t align-top">
                      <td className="p-1"><input disabled={!puedeEditar} value={f.codigo || ''} onChange={(e) => set(k, 'codigo', e.target.value)} className={`${CAMPO} ${f.codigo && !enlace(f.codigo).ok ? 'border-red-400' : ''}`} placeholder="7.04" /></td>
                      <td className="p-1"><textarea disabled={!puedeEditar} rows={1} value={f.descripcion} onChange={(e) => set(k, 'descripcion', e.target.value)} className={CAMPO} /></td>
                      <td className="p-1"><input disabled={!puedeEditar} value={f.unidad || ''} onChange={(e) => set(k, 'unidad', e.target.value)} className={CAMPO} /></td>
                      <td className="p-1"><input disabled={!puedeEditar} type="number" step="any" value={f.cantidad} onChange={(e) => set(k, 'cantidad', e.target.value)} className={`${CAMPO} text-right`} placeholder={f.es_adicional ? 'opcional' : ''} /></td>
                      <td className="p-1"><input disabled={!puedeEditar} type="number" step="any" value={f.valor_unitario} onChange={(e) => set(k, 'valor_unitario', e.target.value)} className={`${CAMPO} text-right`} /></td>
                      <td className="p-2 text-right text-xs">{f.cantidad !== '' && f.cantidad != null ? formatoPesos((Number(f.cantidad) || 0) * (Number(f.valor_unitario) || 0)) : '—'}</td>
                      <td className="p-2 text-center"><input disabled={!puedeEditar} type="checkbox" checked={!!f.es_adicional} onChange={(e) => set(k, 'es_adicional', e.target.checked)} /></td>
                      <td className="p-2 text-right">{puedeEditar && <button onClick={() => quitar(k)} className="text-xs text-neutral-400 hover:text-red-600">Quitar</button>}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-dorado bg-hueso font-semibold">
                    <td className="p-2" colSpan={5}>Total ítems del contrato</td>
                    <td className="p-2 text-right">{formatoPesos(total)}</td>
                    <td colSpan={2} className="p-2 text-xs font-normal text-neutral-500">{Math.abs(total - Number(contrato.valor_inicial)) > 1 ? `Difiere del valor del contrato en ${formatoPesos(total - Number(contrato.valor_inicial))}` : 'Cuadra con el contrato'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {puedeEditar && (
              <div className="flex flex-wrap gap-3 justify-between">
                <div className="flex gap-3">
                  <button onClick={() => setFilas([...filas, nuevaFila(false)])} className="text-sm text-dorado underline">+ Ítem del contrato</button>
                  <button onClick={() => setFilas([...filas, nuevaFila(true)])} className="text-sm text-dorado underline">+ Ítem adicional</button>
                </div>
                <button disabled={guardando} onClick={guardar} className="bg-carbon text-hueso px-5 py-2 rounded text-sm">{guardando ? 'Guardando…' : 'Guardar ítems'}</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
