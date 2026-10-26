'use client';
// Régimen de impuestos del contrato (071): se define una vez en el contrato y lo heredan los cortes, sus OC y el
// Documento del contrato. Con un régimen que discrimina se escribe el valor ANTES de impuestos (form.valor_base) y el
// valor del contrato es ese valor más los impuestos (072: lo calcula la base de datos).
import { REGIMENES_CONTRATO, impuestosRegimen, regimenDiscrimina, formatoPesos } from '@/lib/calculosOC';

const CAMPO = 'border rounded px-3 py-2 text-sm w-full disabled:bg-neutral-50';

export default function RegimenContrato({ form, setForm, disabled = false, bloqueado = false, exigir = false }) {
  const r = form.regimen_impuesto || '';
  const set = (k, v) => setForm({ ...form, [k]: v });
  const imp = impuestosRegimen(form, form.valor_base);
  const total = Math.round((Number(form.valor_base) || 0) + imp.aiu + imp.iva);
  const lista = REGIMENES_CONTRATO.filter((x) => x.valor !== 'SIN_DISCRIMINAR' || r === 'SIN_DISCRIMINAR');
  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-500">Régimen de impuestos del contrato (como la cotización aprobada)</label>
      <select required={exigir} disabled={disabled || bloqueado} value={r} onChange={(e) => set('regimen_impuesto', e.target.value)} className={CAMPO}>
        {exigir && !r && <option value="">Elija el régimen…</option>}
        {lista.map((x) => <option key={x.valor} value={x.valor}>{x.nombre}</option>)}
      </select>
      {bloqueado && <p className="text-[11px] text-neutral-500">El contrato ya tiene cortes aprobados: el régimen no se puede cambiar.</p>}
      {r === 'SIN_DISCRIMINAR' && <p className="text-[11px] text-neutral-500">Contrato anterior al régimen: los ítems llevan el precio final y las OC de los cortes salen sin IVA. Puede cambiarlo mientras no tenga cortes aprobados.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {r === 'AIU' && (
          <>
            <Pct etiqueta="Administración (A) %" valor={form.pct_a} onChange={(v) => set('pct_a', v)} disabled={disabled || bloqueado} />
            <Pct etiqueta="Imprevistos (I) %" valor={form.pct_i} onChange={(v) => set('pct_i', v)} disabled={disabled || bloqueado} />
          </>
        )}
        {(r === 'AIU' || r === 'IVA_UTILIDAD') && (
          <Pct etiqueta={r === 'AIU' ? 'Utilidad (U) %' : 'Utilidad gravable (U) %'} valor={form.pct_u} onChange={(v) => set('pct_u', v)} disabled={disabled || bloqueado} />
        )}
        {['IVA', 'AIU', 'IVA_UTILIDAD'].includes(r) && (
          <Pct etiqueta="IVA %" valor={form.pct_iva} onChange={(v) => set('pct_iva', v)} disabled={disabled || bloqueado} />
        )}
      </div>
      {regimenDiscrimina(r) && r !== 'SIN_IVA' && (
        <p className="text-xs text-neutral-600 bg-hueso border rounded p-2">
          Antes de impuestos {formatoPesos(form.valor_base || 0)}
          {imp.aiu > 0 && <> · A+I+U {formatoPesos(imp.aiu)}</>}
          {' '}· IVA {formatoPesos(imp.iva)} · <b>Valor del contrato (con impuestos) {formatoPesos(total)}</b>.
          {' '}Cada corte genera su OC con este impuesto; el anticipo, la amortización y la retención van sobre el valor antes de impuestos.
        </p>
      )}
    </div>
  );
}

function Pct({ etiqueta, valor, onChange, disabled }) {
  return (
    <label className="block">
      <span className="text-[11px] text-neutral-500 block mb-1">{etiqueta}</span>
      <input type="number" step="any" min="0" disabled={disabled} value={valor ?? ''} onChange={(e) => onChange(e.target.value)} className={CAMPO} />
    </label>
  );
}

/** Etiqueta del campo de valor según el régimen. */
export const etiquetaValor = (r) => (['IVA', 'AIU', 'IVA_UTILIDAD'].includes(r) ? 'Valor antes de impuestos (subtotal de la cotización)' : 'Valor del contrato');
