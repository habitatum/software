'use client';
import { useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';

// ✎ Editar de un corte de DEVOLUCION de retenido (064). Solo admin. Cambia valor devuelto,
// descuento y motivo con actualizar_devolucion_retenido, que ajusta la OC en la misma operación
// (corte y OC siempre con la misma cifra) y no deja devolver más de lo retenido.
export default function EditarDevolucion({ corte, contrato, onHecho }) {
  const [form, setForm] = useState(null);
  const [disponible, setDisponible] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function abrir() {
    setError('');
    const { data } = await crearClienteSupabase().rpc('retenido_por_devolver_contrato', { p_contrato: contrato.id });
    // Disponible = retenido pendiente + lo que este mismo corte ya devolvía y descontaba.
    setDisponible(Number(data || 0) + Number(corte.valor_devolucion || 0) + Number(corte.descuento_retenido || 0));
    setForm({
      valor: String(Number(corte.valor_devolucion || 0)),
      descuento: Number(corte.descuento_retenido) > 0 ? String(Number(corte.descuento_retenido)) : '',
      motivo: corte.motivo_descuento || '',
    });
  }

  async function guardar() {
    const valor = Number(form.valor || 0);
    const descuento = Number(form.descuento || 0);
    if (!(valor + descuento > 0)) { setError('Escribe el valor a devolver.'); return; }
    if (valor + descuento > disponible + 1) { setError(`El retenido disponible para esta devolución es ${formatoPesos(disponible)}.`); return; }
    if (descuento > 0 && (form.motivo || '').trim().length < 5) { setError('Escribe el motivo del descuento al retenido.'); return; }
    if (!window.confirm(`¿Corregir la devolución del corte ${corte.numero} (contrato ${contrato.numero_contrato})?\n\nDevolver: ${formatoPesos(valor)}`
      + `${descuento > 0 ? `\nDescuento al retenido: ${formatoPesos(descuento)} (${form.motivo.trim()})` : ''}`
      + `${corte.ordenes_compra?.folio ? `\n\nLa ${corte.ordenes_compra.folio} se ajusta al mismo valor.` : ''}`)) return;
    setGuardando(true); setError('');
    const { data, error: e } = await crearClienteSupabase().rpc('actualizar_devolucion_retenido', {
      p_corte: corte.id, p_valor: valor, p_descuento: descuento, p_motivo: form.motivo || null,
    });
    setGuardando(false);
    if (e) { setError(e.message.replace(/^DEVOLUCION: /, '')); return; }
    window.alert(`Devolución corregida${data.folio ? ` (corte ${data.corte} y ${data.folio})` : ''}. Retenido por devolver: ${formatoPesos(data.retenido_por_devolver)}.`);
    setForm(null);
    if (onHecho) onHecho();
  }

  return (
    <>
      <button type="button" onClick={abrir} className="text-xs underline text-neutral-600">✎ Editar</button>
      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !guardando && setForm(null)}>
          <div role="dialog" aria-modal="true" aria-label="Editar devolución de retenido" onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-lg w-full max-w-lg text-left whitespace-normal">
            <div className="bg-carbon text-hueso rounded-t-lg px-5 py-3">
              <p className="text-xs text-dorado uppercase tracking-wide">Editar devolución de retenido</p>
              <p className="font-semibold">Contrato {contrato.numero_contrato} · corte {corte.numero}{corte.ordenes_compra?.folio ? ` · ${corte.ordenes_compra.folio}` : ''}</p>
              <p className="text-xs text-gris-calido">Disponible para esta devolución: {formatoPesos(disponible)}</p>
            </div>
            <div className="p-5 grid sm:grid-cols-2 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs text-neutral-600">Valor devuelto</span>
                <input type="number" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="space-y-1"><span className="text-xs text-neutral-600">Descuento al retenido (opcional)</span>
                <input type="number" inputMode="decimal" value={form.descuento} onChange={(e) => setForm({ ...form, descuento: e.target.value })} className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="sm:col-span-2 space-y-1"><span className="text-xs text-neutral-600">Motivo del descuento</span>
                <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Solo si hay descuento" className="border rounded px-2 py-1.5 w-full" /></label>
              <p className="sm:col-span-2 text-[11px] text-neutral-500">
                La orden de compra se ajusta sola al mismo valor (conserva su imputación al presupuesto). La fecha no cambia.
              </p>
              {error && <p className="sm:col-span-2 text-xs text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" disabled={guardando} onClick={() => setForm(null)} className="px-3 py-1.5 rounded border text-sm">Cancelar</button>
              <button type="button" disabled={guardando} onClick={guardar} className="bg-carbon text-hueso px-4 py-1.5 rounded text-sm disabled:opacity-50">
                {guardando ? 'Guardando…' : 'Guardar corrección'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
