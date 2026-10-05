'use client';
import { useEffect, useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';

// Botón "Devolver retenido" (047) con su ventana. Se usa junto a "+ Nuevo corte"
// en el listado de contratos, en la sábana de cortes y en el detalle del contrato.
// Solo lo ve el admin y solo si el contrato tiene retenido pendiente de devolver.
export default function DevolverRetenido({ contrato, usuario, onHecho, compacto = false }) {
  const [saldo, setSaldo] = useState(0);
  const [pagaCliente, setPagaCliente] = useState(false);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const esAdmin = usuario?.rol === 'admin';

  async function cargar() {
    const s = crearClienteSupabase();
    const { data } = await s.rpc('retenido_por_devolver_contrato', { p_contrato: contrato.id });
    setSaldo(Number(data || 0));
    // Por defecto paga quien pagó el contrato (cliente directo o el constructor).
    const { data: pagos } = await s.from('ordenes_compra').select('pagado_por_cliente')
      .eq('contrato_id', contrato.id).neq('estado', 'ANULADA').neq('tipo_pago', 'ANTICIPO').limit(20);
    setPagaCliente((pagos || []).length > 0 && (pagos || []).every((x) => x.pagado_por_cliente));
  }
  useEffect(() => { if (esAdmin && contrato?.id) cargar(); }, [contrato?.id, esAdmin]); // eslint-disable-line

  if (!esAdmin || saldo <= 0.5 || contrato?.estado === 'ANULADO') return null;

  function abrir() {
    setError('');
    setForm({ valor: String(saldo), descuento: '', motivo: '', fecha: new Date().toISOString().slice(0, 10), cliente: pagaCliente });
  }

  async function registrar() {
    const valor = Number(form.valor || 0);
    const descuento = Number(form.descuento || 0);
    if (!(valor + descuento > 0)) { setError('Escribe el valor a devolver.'); return; }
    if (valor + descuento > saldo + 1) { setError(`El retenido por devolver es ${formatoPesos(saldo)}.`); return; }
    if (descuento > 0 && (form.motivo || '').trim().length < 5) { setError('Escribe el motivo del descuento al retenido.'); return; }
    if (!window.confirm(`¿Registrar la devolución de retenido del contrato ${contrato.numero_contrato}?\n\nDevolver: ${formatoPesos(valor)}`
      + `${descuento > 0 ? `\nDescuento al retenido: ${formatoPesos(descuento)} (${form.motivo.trim()})` : ''}`
      + `\nPaga: ${form.cliente ? 'el cliente directamente' : 'el constructor'}\n\nSe crea el corte de devolución y su orden de compra.`)) return;
    setGuardando(true); setError('');
    const { data, error: e } = await crearClienteSupabase().rpc('devolver_retenido_contrato', {
      p_contrato: contrato.id, p_fecha: form.fecha, p_valor: valor, p_descuento: descuento,
      p_motivo: form.motivo || null, p_pagado_por_cliente: !!form.cliente,
    });
    setGuardando(false);
    if (e) { setError(e.message.replace(/^DEVOLUCION: /, '')); return; }
    window.alert(`Devolución registrada en el corte ${data.corte}${data.folio ? ` (${data.folio})` : ''}. Retenido por devolver: ${formatoPesos(data.retenido_por_devolver)}.`);
    setForm(null);
    await cargar();
    if (onHecho) onHecho();
  }

  const clase = compacto
    ? 'inline-block border border-carbon text-carbon px-3 py-1.5 rounded text-xs whitespace-nowrap mr-2 align-middle hover:bg-hueso'
    : 'border border-carbon text-carbon px-4 py-2 rounded text-sm whitespace-nowrap hover:bg-hueso';

  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); abrir(); }} className={clase} title={`Retenido por devolver: ${formatoPesos(saldo)}`}>
        Devolver retenido
      </button>
      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !guardando && setForm(null)}>
          <div role="dialog" aria-modal="true" aria-label="Devolver retenido" onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-lg w-full max-w-lg text-left">
            <div className="bg-carbon text-hueso rounded-t-lg px-5 py-3">
              <p className="text-xs text-dorado uppercase tracking-wide">Devolución de retenido</p>
              <p className="font-semibold">Contrato {contrato.numero_contrato}</p>
              <p className="text-xs text-gris-calido">Retenido por devolver: {formatoPesos(saldo)}</p>
            </div>
            <div className="p-5 grid sm:grid-cols-2 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs text-neutral-600">Valor a devolver</span>
                <input type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="space-y-1"><span className="text-xs text-neutral-600">Fecha</span>
                <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="space-y-1"><span className="text-xs text-neutral-600">Descuento al retenido (opcional)</span>
                <input type="number" value={form.descuento} onChange={(e) => setForm({ ...form, descuento: e.target.value })} className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="space-y-1"><span className="text-xs text-neutral-600">Motivo del descuento</span>
                <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Solo si hay descuento" className="border rounded px-2 py-1.5 w-full" /></label>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-neutral-700">
                <input type="checkbox" checked={!!form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.checked })} />
                La paga el cliente directamente
              </label>
              {error && <p className="sm:col-span-2 text-xs text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" disabled={guardando} onClick={() => setForm(null)} className="px-3 py-1.5 rounded border text-sm">Cancelar</button>
              <button type="button" disabled={guardando} onClick={registrar} className="bg-carbon text-hueso px-4 py-1.5 rounded text-sm disabled:opacity-50">
                {guardando ? 'Registrando…' : 'Registrar devolución'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
