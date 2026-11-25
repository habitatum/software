'use client';
import { useEffect, useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { BotonComprobante } from '@/lib/Comprobantes';

// 082 · Agregar un gasto a una legalización de caja menor ya cerrada (OC con origen CAJA_MENOR, vigente).
// Operativo: queda PENDIENTE hasta que el admin lo apruebe (no toca la OC ni la caja menor mientras tanto).
// Admin: se aplica de una vez. Aprobar/rechazar lo hace la base de datos (solo admin).
const CAMPO = 'border rounded px-2 py-1.5 text-sm w-full bg-white';
const hoy = () => new Date().toISOString().slice(0, 10);
const fecha = (f) => { const p = String(f || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ''; };
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export default function GastosLegalizacion({ ocId, proyectoId, rol, pagado = 0, onCambio }) {
  const [oc, setOc] = useState(null);
  const [solicitudes, setSolicitudes] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [itemsPres, setItemsPres] = useState([]);
  const [form, setForm] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [version, setVersion] = useState(0);
  const esAdmin = rol === 'admin';

  useEffect(() => {
    (async () => {
      const s = crearClienteSupabase();
      const { data: o } = await s.from('ordenes_compra').select('id, origen, estado').eq('id', ocId).single();
      setOc(o);
      if (!o || o.origen !== 'CAJA_MENOR') return;
      const { data: sol } = await s.from('solicitudes_gasto_legalizacion').select('*').eq('oc_id', ocId).order('creado_en', { ascending: false });
      setSolicitudes(sol || []);
    })();
  }, [ocId, version]);

  async function abrirForm() {
    const s = crearClienteSupabase();
    const { data: pres } = await s.from('presupuestos').select('id').eq('proyecto_id', proyectoId).maybeSingle();
    if (pres) {
      const { data: caps } = await s.from('presupuesto_capitulos').select('id, codigo, nombre').eq('presupuesto_id', pres.id).order('orden');
      setCapitulos(caps || []);
    }
    setForm({ fecha: hoy(), concepto: '', valor: '', capitulo_id: '', presupuesto_item_id: '' });
    setArchivo(null);
  }
  async function elegirCapitulo(id) {
    setForm((f) => ({ ...f, capitulo_id: id, presupuesto_item_id: '' }));
    if (!id) { setItemsPres([]); return; }
    const { data } = await crearClienteSupabase().from('presupuesto_items').select('id, codigo, descripcion').eq('capitulo_id', id).order('orden');
    setItemsPres(data || []);
  }

  async function enviar() {
    if (!form.concepto.trim() || !(Number(form.valor) > 0)) { window.alert('Escriba el concepto y el valor del gasto.'); return; }
    if (capitulos.length && !form.capitulo_id) { window.alert('Elija el capítulo del presupuesto.'); return; }
    if (!archivo) { window.alert('Adjunte el comprobante (PDF, JPG o PNG).'); return; }
    const ext = EXT[archivo.type] || (archivo.name.match(/\.(pdf|jpe?g|png)$/i)?.[1] || '').toLowerCase().replace('jpeg', 'jpg');
    if (!ext) { window.alert('El comprobante debe ser PDF, JPG o PNG.'); return; }
    if (archivo.size > 10 * 1024 * 1024) { window.alert('El archivo pesa más de 10 MB.'); return; }
    if (esAdmin && Number(pagado) > 0 && !window.confirm('Esta OC ya tiene pagos registrados. Al agregar el gasto su total sube y queda saldo pendiente por pagar. ¿Continuar?')) return;
    setTrabajando(true);
    try {
      const s = crearClienteSupabase();
      const ruta = `${proyectoId}/${hoy().slice(0, 7)}/legalizacion-${ocId}-${Date.now()}.${ext}`;
      const { error: e1 } = await s.storage.from('soportes-oc').upload(ruta, archivo, { contentType: archivo.type || undefined });
      if (e1) throw e1;
      const { data, error: e2 } = await s.rpc('solicitar_gasto_legalizacion', {
        p_oc: ocId, p_fecha: form.fecha, p_concepto: form.concepto, p_valor: Number(form.valor),
        p_capitulo: form.capitulo_id || null, p_item: form.presupuesto_item_id || null, p_soporte: ruta,
      });
      if (e2) throw e2;
      setForm(null);
      setVersion((v) => v + 1);
      if (data?.estado === 'APROBADA') onCambio?.();
      else window.alert('Solicitud enviada. Queda pendiente hasta que el administrador la apruebe.');
    } catch (e) { window.alert(`No se pudo enviar: ${e.message}`); }
    finally { setTrabajando(false); }
  }
  async function aprobar(sol) {
    if (Number(pagado) > 0 && !window.confirm('Esta OC ya tiene pagos registrados. Al aprobar, su total sube y queda saldo pendiente por pagar. ¿Aprobar?')) return;
    if (!(Number(pagado) > 0) && !window.confirm(`¿Aprobar "${sol.concepto}" por ${formatoPesos(sol.valor)}? Se agrega a esta OC.`)) return;
    setTrabajando(true);
    const { error } = await crearClienteSupabase().rpc('aprobar_gasto_legalizacion', { p_id: sol.id });
    setTrabajando(false);
    if (error) { window.alert(error.message); return; }
    setVersion((v) => v + 1); onCambio?.();
  }
  async function rechazar(sol) {
    const motivo = window.prompt(`Motivo del rechazo de "${sol.concepto}":`);
    if (motivo === null) return;
    setTrabajando(true);
    const { error } = await crearClienteSupabase().rpc('rechazar_gasto_legalizacion', { p_id: sol.id, p_motivo: motivo });
    setTrabajando(false);
    if (error) { window.alert(error.message); return; }
    setVersion((v) => v + 1);
  }

  if (!oc || oc.origen !== 'CAJA_MENOR' || rol === 'lectura') return null;
  const pendientes = solicitudes.filter((x) => x.estado === 'PENDIENTE');
  const otras = solicitudes.filter((x) => x.estado === 'RECHAZADA');

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 sm:p-5 space-y-3 text-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="font-medium">Gastos adicionales de esta legalización</p>
          <p className="text-xs text-neutral-500">Para un gasto de caja menor que quedó por fuera de esta legalización. {esAdmin ? 'Como administrador se aplica de una vez.' : 'Queda pendiente hasta que el administrador lo apruebe.'}</p>
        </div>
        {oc.estado === 'VIGENTE' && !form && (
          <button type="button" onClick={abrirForm} className="border border-dorado text-[#6b4a22] rounded px-3 py-1.5 text-xs whitespace-nowrap hover:bg-hueso self-start">+ Agregar gasto a esta legalización</button>
        )}
      </div>

      {form && (
        <div className="border rounded-lg p-3 space-y-3 bg-hueso/40">
          <div className="grid sm:grid-cols-[140px_1fr_150px] gap-2">
            <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={CAMPO} />
            <input value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Concepto (ej. Transporte material DiDi)" className={CAMPO} />
            <input type="number" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="Valor" className={`${CAMPO} text-right`} />
          </div>
          {capitulos.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-2">
              <select value={form.capitulo_id} onChange={(e) => elegirCapitulo(e.target.value)} className={CAMPO}>
                <option value="">Capítulo del presupuesto…</option>
                {capitulos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
              <select value={form.presupuesto_item_id} onChange={(e) => setForm({ ...form, presupuesto_item_id: e.target.value })} disabled={!form.capitulo_id} className={CAMPO}>
                <option value="">Todo el capítulo (sin ítem)</option>
                {itemsPres.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descripcion}</option>)}
              </select>
            </div>
          )}
          <label className="block text-xs text-neutral-600">Comprobante (PDF, JPG o PNG) — obligatorio
            <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="block mt-1 text-xs" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={trabajando} onClick={enviar} className="bg-carbon text-hueso rounded px-3 py-1.5 text-xs disabled:opacity-50">
              {trabajando ? 'Enviando…' : (esAdmin ? 'Agregar a la OC' : 'Enviar para aprobación')}
            </button>
            <button type="button" disabled={trabajando} onClick={() => setForm(null)} className="border rounded px-3 py-1.5 text-xs bg-white">Cancelar</button>
          </div>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="space-y-2">
          {pendientes.map((x) => (
            <div key={x.id} className="border border-amber-300 bg-amber-50 rounded p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1">
                <p className="font-medium">⏳ Pendiente de aprobación · {formatoPesos(x.valor)}</p>
                <p className="text-xs text-neutral-600">{fecha(x.fecha)} · {x.concepto}{x.solicitante ? ` · pidió ${x.solicitante}` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <BotonComprobante ruta={x.soporte_path} texto="Ver comprobante" />
                {esAdmin && (
                  <>
                    <button type="button" disabled={trabajando} onClick={() => aprobar(x)} className="bg-carbon text-hueso rounded px-3 py-1 text-xs disabled:opacity-50">✅ Aprobar</button>
                    <button type="button" disabled={trabajando} onClick={() => rechazar(x)} className="border border-red-300 text-red-700 rounded px-3 py-1 text-xs">✕ Rechazar</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {otras.length > 0 && (
        <div className="text-xs text-neutral-500 space-y-1">
          {otras.map((x) => <p key={x.id}>✕ Rechazado: {fecha(x.fecha)} · {x.concepto} · {formatoPesos(x.valor)} — {x.motivo_rechazo}</p>)}
        </div>
      )}
    </div>
  );
}

// Aviso en el listado de Órdenes de Compra (solo admin): solicitudes pendientes de la obra.
export function AvisoGastosLegalizacion({ proyectoId }) {
  const [pend, setPend] = useState([]);
  useEffect(() => {
    if (!proyectoId) return;
    (async () => {
      const { data } = await crearClienteSupabase().from('solicitudes_gasto_legalizacion')
        .select('id, oc_id, valor, ordenes_compra!inner(folio, proyecto_id)').eq('estado', 'PENDIENTE').eq('ordenes_compra.proyecto_id', proyectoId);
      setPend(data || []);
    })();
  }, [proyectoId]);
  if (!pend.length) return null;
  const porOc = {};
  pend.forEach((x) => { porOc[x.oc_id] = porOc[x.oc_id] || { folio: x.ordenes_compra.folio, n: 0, v: 0 }; porOc[x.oc_id].n++; porOc[x.oc_id].v += Number(x.valor); });
  return (
    <div className="mb-4 border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm">
      <p className="font-medium">⏳ {pend.length} {pend.length === 1 ? 'gasto pendiente' : 'gastos pendientes'} de aprobar en legalizaciones de caja menor</p>
      <div className="flex flex-wrap gap-3 mt-1 text-xs">
        {Object.entries(porOc).map(([id, x]) => (
          <a key={id} href={`/ordenes-compra/${id}`} className="underline text-[#6b4a22]">{x.folio}: {x.n} · {formatoPesos(x.v)}</a>
        ))}
      </div>
    </div>
  );
}
