'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';

// ============================================================
// Cortes de obra de un contrato + avance por ítem del contrato.
// Se muestra en /contratos/[id].
// ============================================================

function fmtCant(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

function fecha(f) {
  if (!f) return '—';
  const p = String(f).slice(0, 10).split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

export default function SeccionCortes({ contrato, usuario }) {
  const [items, setItems] = useState([]);
  const [cortes, setCortes] = useState([]);
  const [verItems, setVerItems] = useState(false);
  const puedeCrear = usuario?.rol === 'admin' || usuario?.rol === 'operativo';

  async function cargar() {
    const supabase = crearClienteSupabase();
    const [{ data: its }, { data: cs }] = await Promise.all([
      supabase.from('v_contrato_items_avance').select('*').eq('contrato_id', contrato.id).order('es_adicional').order('orden'),
      supabase.from('cortes').select('*, ordenes_compra(folio)').eq('contrato_id', contrato.id).order('numero', { ascending: false }),
    ]);
    setItems(its || []);
    setCortes(cs || []);
  }
  useEffect(() => { cargar(); }, [contrato.id]); // eslint-disable-line

  const contratado = items.filter((i) => !i.es_adicional).reduce((a, i) => a + Number(i.cantidad || 0) * Number(i.valor_unitario), 0);
  const ejecutado = items.reduce((a, i) => a + Number(i.acumulado || 0) * Number(i.valor_unitario), 0);
  const avance = contratado > 0 ? Math.round((ejecutado / contratado) * 1000) / 10 : 0;
  const borrador = cortes.find((c) => c.estado === 'BORRADOR');

  return (
    <div className="bg-white rounded-lg shadow-sm border">
      <div className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Cortes de obra</h2>
          <p className="text-xs text-neutral-500">
            {items.length === 0
              ? 'Este contrato todavía no tiene ítems cargados para hacer cortes.'
              : `Ejecutado ${formatoPesos(ejecutado)} de ${formatoPesos(contratado)} contratados (${avance}%)`}
          </p>
        </div>
        {puedeCrear && items.length > 0 && contrato.estado !== 'ANULADO' && (
          borrador ? (
            <Link href={`/contratos/${contrato.id}/cortes/${borrador.id}`} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              Continuar corte No. {borrador.numero} (borrador)
            </Link>
          ) : (
            <Link href={`/contratos/${contrato.id}/cortes/nuevo`} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              + Nuevo corte
            </Link>
          )
        )}
      </div>

      {cortes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left">
              <tr><th className="p-3">Corte</th><th className="p-3">Fecha</th><th className="p-3 text-right">Subtotal</th><th className="p-3 text-right">Neto a pagar</th><th className="p-3">Estado</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {cortes.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-medium">No. {c.numero}</td>
                  <td className="p-3">{fecha(c.fecha)}</td>
                  <td className="p-3 text-right">{c.subtotal != null ? formatoPesos(c.subtotal) : '—'}</td>
                  <td className="p-3 text-right">{c.neto != null ? formatoPesos(c.neto) : '—'}</td>
                  <td className="p-3">
                    {c.estado === 'APROBADO'
                      ? <span className="text-xs text-green-700">Aprobado · {c.ordenes_compra?.folio}</span>
                      : <span className="text-xs text-amber-700">Borrador</span>}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap space-x-3">
                    <Link href={`/contratos/${contrato.id}/cortes/${c.id}`} className="text-xs underline text-neutral-600">{c.estado === 'BORRADOR' ? 'Editar' : 'Ver'}</Link>
                    <button
                      onClick={() => compartirOAbrirArchivo(`/api/cortes/${c.id}/pdf`, `Corte ${c.numero} ${contrato.numero_contrato}.pdf`)}
                      className="text-xs underline text-dorado"
                    >PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {contrato.cortes_previos > 0 && (
        <p className="px-4 py-2 text-[11px] text-neutral-500 border-t">
          Este contrato tuvo {contrato.cortes_previos} cortes antes del módulo; sus cantidades ya están incluidas en el acumulado de cada ítem.
        </p>
      )}

      {items.length > 0 && (
        <div className="border-t">
          <button onClick={() => setVerItems(!verItems)} className="w-full text-left px-4 py-3 text-sm text-neutral-600 hover:bg-hueso/50">
            {verItems ? '▾' : '▸'} Avance por ítem del contrato ({items.length} ítems)
          </button>
          {verItems && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-neutral-500 bg-hueso/60">
                  <tr><th className="p-2">Ítem</th><th className="p-2">Und</th><th className="p-2 text-right">Contratado</th><th className="p-2 text-right">Acumulado</th><th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Vr. unitario</th></tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => {
                    const excedido = i.cantidad != null && Number(i.acumulado) > Number(i.cantidad) + 0.0005;
                    const primerAdicional = i.es_adicional && (idx === 0 || !items[idx - 1].es_adicional);
                    return (
                      <Fragment key={i.id}>
                        {primerAdicional && <tr><td colSpan={6} className="p-2 pt-3 font-semibold text-neutral-600 border-t">Adicionales</td></tr>}
                        <tr className="border-t">
                          <td className="p-2">{i.codigo ? `${i.codigo} · ` : ''}{i.descripcion.length > 90 ? i.descripcion.slice(0, 90) + '…' : i.descripcion}</td>
                          <td className="p-2">{i.unidad}</td>
                          <td className="p-2 text-right">{fmtCant(i.cantidad)}</td>
                          <td className={`p-2 text-right ${excedido ? 'text-red-700 font-semibold' : ''}`}>{fmtCant(i.acumulado)}</td>
                          <td className={`p-2 text-right ${excedido ? 'text-red-700' : ''}`}>{i.saldo == null ? '—' : fmtCant(i.saldo)}</td>
                          <td className="p-2 text-right">{formatoPesos(i.valor_unitario)}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-4 py-2 text-[11px] text-neutral-500">En rojo: ítems donde lo ejecutado supera lo contratado.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
