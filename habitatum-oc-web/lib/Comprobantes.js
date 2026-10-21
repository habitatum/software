'use client';
import { useEffect, useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';

// Comprobantes que llegan por el bot de Telegram: se guardan en el almacenamiento
// privado `soportes-oc` (obra/AAAA-MM/archivo) y se abren con un enlace firmado
// de 10 minutos. Los ve cualquier usuario con sesión.

// Abre el comprobante en otra pestaña. La ventana se abre en el clic para que
// el iPhone no la bloquee y luego se le carga el enlace firmado.
export async function abrirComprobante(ruta) {
  if (!ruta) return;
  const ventana = window.open('', '_blank');
  const { data, error } = await crearClienteSupabase().storage.from('soportes-oc').createSignedUrl(ruta, 600);
  if (error || !data?.signedUrl) {
    if (ventana) ventana.close();
    window.alert(`No se pudo abrir el comprobante: ${error?.message || 'archivo no encontrado'}`);
    return;
  }
  if (ventana) ventana.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

export function BotonComprobante({ ruta, texto = 'Ver comprobante', className = '' }) {
  if (!ruta) return null;
  return (
    <button type="button" onClick={() => abrirComprobante(ruta)}
      className={`text-xs underline text-neutral-600 hover:text-carbon whitespace-nowrap ${className}`}>
      {texto}
    </button>
  );
}

function fecha(f) {
  if (!f) return '';
  const p = String(f).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f);
}

// Lista de gastos de caja menor con su comprobante.
// - ocId: gastos legalizados en esa OC.
// - proyecto (sin ocId): gastos pendientes de legalizar de la obra, contra su tope.
export function GastosCajaMenor({ proyecto, ocId = null, plegable = false, esAdmin = false }) {
  const [gastos, setGastos] = useState(null);
  const [abierto, setAbierto] = useState(!plegable);
  const [recibo, setRecibo] = useState(null); // ventana "Generar recibo" (065)
  const [trabajando, setTrabajando] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    (async () => {
      const s = crearClienteSupabase();
      let q = s.from('caja_menor_gastos').select('id, fecha, valor, concepto, remitente, soporte_path, recibo_folio, beneficiario_nombre, beneficiario_documento, beneficiario_cuenta').order('fecha').order('creado_en');
      q = ocId ? q.eq('oc_id', ocId) : q.eq('proyecto_id', proyecto.id).is('oc_id', null);
      const { data } = await q;
      setGastos(data || []);
    })();
  }, [ocId, proyecto?.id, version]);

  async function token() {
    const { data: { session } } = await crearClienteSupabase().auth.getSession();
    return session?.access_token || '';
  }
  // 065: recibo de caja menor para un gasto sin soporte del proveedor (solo admin).
  async function generarRecibo() {
    setTrabajando(recibo.id);
    const resp = await fetch(`/api/caja-menor/${recibo.id}/recibo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ nombre: recibo.nombre, documento: recibo.documento, cuenta: recibo.cuenta }),
    });
    const r = await resp.json().catch(() => ({}));
    setTrabajando(null);
    if (!resp.ok) { window.alert(r.error || 'No se pudo generar el recibo.'); return; }
    setRecibo(null);
    setVersion((v) => v + 1);
  }
  // 065: reemplazar el soporte (foto/PDF real del proveedor o recibo firmado).
  async function reemplazar(g, archivo) {
    if (!archivo) return;
    if (archivo.size > 4 * 1024 * 1024) { window.alert('El archivo pesa más de 4 MB. Envíalo más liviano (foto normal, no en máxima calidad).'); return; }
    if (!window.confirm(`¿Reemplazar el soporte de "${g.concepto}" (${formatoPesos(g.valor)}) por ${archivo.name}?`)) return;
    setTrabajando(g.id);
    const datos = new FormData();
    datos.append('archivo', archivo);
    const resp = await fetch(`/api/caja-menor/${g.id}/soporte`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: datos });
    const r = await resp.json().catch(() => ({}));
    setTrabajando(null);
    if (!resp.ok) { window.alert(r.error || 'No se pudo reemplazar el soporte.'); return; }
    setVersion((v) => v + 1);
  }

  if (gastos === null) return null;
  if (ocId && gastos.length === 0) return null;
  const total = gastos.reduce((a, g) => a + Number(g.valor || 0), 0);
  const tope = Number(proyecto?.tope_caja_menor || 0);
  const pct = tope > 0 ? Math.min(100, (total / tope) * 100) : 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 sm:p-5 space-y-3 text-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="font-medium">{ocId ? 'Gastos de caja menor legalizados en esta orden' : 'Caja menor pendiente de legalizar'}</p>
          <p className="text-xs text-neutral-500">
            {gastos.length} {gastos.length === 1 ? 'gasto' : 'gastos'} · {formatoPesos(total)}
            {!ocId && tope > 0 && ` de ${formatoPesos(tope)} (al llegar al tope, el bot genera la OC de legalización)`}
          </p>
        </div>
        {plegable && gastos.length > 0 && (
          <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
            className="border border-neutral-300 px-3 py-1.5 rounded text-xs whitespace-nowrap hover:bg-neutral-50 self-start">
            {abierto ? 'Ocultar gastos' : 'Ver gastos y comprobantes'}
          </button>
        )}
      </div>
      {!ocId && tope > 0 && (
        <div className="h-1.5 bg-hueso rounded overflow-hidden" aria-hidden="true">
          <div className={`h-full ${pct >= 90 ? 'bg-amber-500' : 'bg-dorado'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {abierto && (gastos.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">No hay gastos pendientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-left text-xs text-neutral-500 border-b">
              <th className="p-2 font-medium w-24">Fecha</th><th className="p-2 font-medium">Concepto</th>
              <th className="p-2 font-medium">Envió</th><th className="p-2 font-medium text-right">Valor</th><th className="p-2 w-28" />
            </tr></thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{fecha(g.fecha)}</td>
                  <td className="p-2">
                    {g.concepto}
                    {g.recibo_folio && <span className="block text-[11px] text-neutral-500">Recibo {g.recibo_folio}{g.beneficiario_nombre ? ` · ${g.beneficiario_nombre}` : ''}</span>}
                  </td>
                  <td className="p-2 text-neutral-500">{g.remitente || '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap">{formatoPesos(g.valor)}</td>
                  <td className="p-2 text-right whitespace-nowrap space-x-2">
                    {g.soporte_path ? <BotonComprobante ruta={g.soporte_path} texto={g.soporte_path.includes('/recibos/') ? 'Ver recibo' : 'Ver comprobante'} /> : <span className="text-xs text-neutral-400">sin soporte</span>}
                    {esAdmin && !g.soporte_path && (
                      <button type="button" disabled={trabajando === g.id}
                        onClick={() => setRecibo({ id: g.id, concepto: g.concepto, valor: g.valor, nombre: g.beneficiario_nombre || '', documento: g.beneficiario_documento || '', cuenta: g.beneficiario_cuenta || '' })}
                        className="text-xs underline text-dorado">Generar recibo</button>
                    )}
                    {esAdmin && (
                      <label className={`text-xs underline cursor-pointer ${trabajando === g.id ? 'text-neutral-300' : 'text-neutral-600 hover:text-carbon'}`}>
                        {trabajando === g.id ? 'Subiendo…' : (g.soporte_path ? 'Reemplazar' : 'Subir soporte')}
                        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={trabajando === g.id}
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; reemplazar(g, f); }} />
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {recibo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !trabajando && setRecibo(null)}>
          <div role="dialog" aria-modal="true" aria-label="Generar recibo de caja menor" onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-lg w-full max-w-md text-left">
            <div className="bg-carbon text-hueso rounded-t-lg px-5 py-3">
              <p className="text-xs text-dorado uppercase tracking-wide">Recibo de caja menor</p>
              <p className="font-semibold">{recibo.concepto} · {formatoPesos(recibo.valor)}</p>
              <p className="text-xs text-gris-calido">Queda como soporte del gasto. El beneficiario es opcional (se puede llenar a mano en el recibo).</p>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <label className="block space-y-1"><span className="text-xs text-neutral-600">Pagado a (nombre)</span>
                <input value={recibo.nombre} onChange={(e) => setRecibo({ ...recibo, nombre: e.target.value })} className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="block space-y-1"><span className="text-xs text-neutral-600">Cédula o NIT (opcional)</span>
                <input value={recibo.documento} onChange={(e) => setRecibo({ ...recibo, documento: e.target.value })} placeholder="CC 1.036.000.000" className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="block space-y-1"><span className="text-xs text-neutral-600">Cuenta o medio de pago (opcional)</span>
                <input value={recibo.cuenta} onChange={(e) => setRecibo({ ...recibo, cuenta: e.target.value })} placeholder="Bancolombia ahorros 123-456789-01" className="border rounded px-2 py-1.5 w-full" /></label>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" disabled={!!trabajando} onClick={() => setRecibo(null)} className="px-3 py-1.5 rounded border text-sm">Cancelar</button>
              <button type="button" disabled={!!trabajando} onClick={generarRecibo} className="bg-carbon text-hueso px-4 py-1.5 rounded text-sm disabled:opacity-50">
                {trabajando ? 'Generando…' : 'Generar recibo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
