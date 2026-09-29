'use client';
import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import NavBar from '@/components/NavBar';

// ============================================================
// SÁBANA DE CORTES: la misma vista del Excel de cortes de obra.
// Filas = ítems del contrato (y adicionales); columnas = contractual,
// cada corte aprobado (cant / valor) y acumulados. Al final: subtotales,
// total corte, retenido, amortización y total pagado por corte.
// ============================================================

const n = (v) => Number(v || 0);
const cant = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
const fecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const $ = (v) => (n(v) ? formatoPesos(Math.round(n(v))) : '—');

const TH = 'p-2 text-[11px] font-semibold whitespace-nowrap';
const TD = 'p-2 text-xs whitespace-nowrap text-right';
const STICKY = 'sticky left-0 z-10';

export default function SabanaCortes() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [d, setD] = useState(null);

  useEffect(() => {
    if (!usuario || !proyecto) return;
    (async () => {
      const s = crearClienteSupabase();
      const [{ data: contrato }, { data: items }, { data: cortes }, { data: anticipos }] = await Promise.all([
        s.from('contratos').select('*, proveedores:contratista_id(nombre)').eq('id', id).single(),
        s.from('contrato_items').select('*').eq('contrato_id', id).order('orden'),
        s.from('cortes').select('*, ordenes_compra(folio), corte_items(*)').eq('contrato_id', id).eq('estado', 'APROBADO').order('numero'),
        s.from('v_ordenes_compra_calculadas').select('id, folio, fecha, total, saldo_anticipo_por_amortizar').eq('contrato_id', id).eq('tipo_pago', 'ANTICIPO').neq('estado', 'ANULADA').order('fecha'),
      ]);
      setD({ contrato, items: items || [], cortes: cortes || [], anticipos: anticipos || [] });
    })();
  }, [usuario, proyecto, id]);

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;

  const c = d?.contrato;
  const items = d?.items || [];
  const cortes = d?.cortes || [];
  const contractuales = items.filter((i) => !i.es_adicional);
  const adicionales = items.filter((i) => i.es_adicional);
  const qty = (corte, itemId) => (corte.corte_items || []).filter((x) => x.contrato_item_id === itemId).reduce((a, x) => a + n(x.cantidad), 0);
  const acum = (itemId) => cortes.reduce((a, k) => a + qty(k, itemId), 0);
  const subCorte = (corte, lista) => lista.reduce((a, i) => a + qty(corte, i.id) * n(i.valor_unitario), 0);
  const subContratado = contractuales.reduce((a, i) => a + n(i.cantidad) * n(i.valor_unitario), 0);
  const totalAnticipos = (d?.anticipos || []).reduce((a, x) => a + n(x.total), 0);
  const saldoAnticipo = (d?.anticipos || []).reduce((a, x) => a + n(x.saldo_anticipo_por_amortizar), 0);
  const tot = (campo) => cortes.reduce((a, k) => a + n(k[campo]), 0);

  function filaItem(i) {
    const a = acum(i.id);
    const excede = i.cantidad != null && a > n(i.cantidad) + 0.0005;
    return (
      <tr key={i.id} className="border-t hover:bg-hueso/40">
        <td className={`${STICKY} bg-white p-2 text-xs min-w-[260px] max-w-[340px]`}>{i.codigo ? <strong>{i.codigo} · </strong> : null}{i.descripcion.length > 110 ? i.descripcion.slice(0, 110) + '…' : i.descripcion}</td>
        <td className="p-2 text-xs">{i.unidad}</td>
        <td className={TD}>{cant(i.cantidad)}</td>
        <td className={TD}>{$(i.valor_unitario)}</td>
        <td className={`${TD} border-r`}>{i.cantidad != null ? $(n(i.cantidad) * n(i.valor_unitario)) : ''}</td>
        {cortes.map((k) => {
          const q = qty(k, i.id);
          return (
            <Fragment key={k.id}>
              <td className={`${TD} bg-[#b88a52]/[0.07]`}>{q ? cant(q) : ''}</td>
              <td className={`${TD} border-r`}>{q ? $(q * n(i.valor_unitario)) : ''}</td>
            </Fragment>
          );
        })}
        <td className={`${TD} bg-[#3b5b7a]/[0.08] ${excede ? 'text-red-700 font-semibold' : ''}`}>{a ? cant(a) : ''}</td>
        <td className={`${TD} bg-[#3b5b7a]/[0.08]`}>{a ? $(a * n(i.valor_unitario)) : ''}</td>
        <td className={`${TD} ${excede ? 'text-red-700' : ''}`}>{i.cantidad != null ? cant(n(i.cantidad) - a) : ''}</td>
      </tr>
    );
  }

  function filaTotales(etiqueta, valorPorCorte, valorContrato, estilo = '') {
    return (
      <tr className={`border-t ${estilo}`}>
        <td className={`${STICKY} p-2 text-xs font-semibold ${estilo || 'bg-white'}`} colSpan={1}>{etiqueta}</td>
        <td colSpan={3} />
        <td className={`${TD} font-semibold border-r`}>{valorContrato !== undefined ? $(valorContrato) : ''}</td>
        {cortes.map((k) => (
          <Fragment key={k.id}><td /><td className={`${TD} font-semibold border-r`}>{valorPorCorte(k)}</td></Fragment>
        ))}
        <td />
        <td className={`${TD} font-semibold`}>{valorPorCorte(null)}</td>
        <td />
      </tr>
    );
  }

  async function descargarExcel() {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cortes');
    const enc = ['Ítem', 'Und', 'Cant. contratada', 'Vr. unitario', 'Subtotal contratado'];
    cortes.forEach((k) => enc.push(`Corte ${k.numero} cant.`, `Corte ${k.numero} valor`));
    enc.push('Acumulado cant.', 'Acumulado valor', 'Saldo cant.');
    ws.addRow([`Contrato ${c.numero_contrato} · ${c.proveedores?.nombre} · ${c.concepto}`]);
    ws.addRow(enc).font = { bold: true };
    const fila = (i) => {
      const r = [(i.codigo ? i.codigo + ' · ' : '') + i.descripcion, i.unidad, i.cantidad != null ? n(i.cantidad) : null, n(i.valor_unitario), i.cantidad != null ? n(i.cantidad) * n(i.valor_unitario) : null];
      cortes.forEach((k) => { const q = qty(k, i.id); r.push(q || null, q ? q * n(i.valor_unitario) : null); });
      const a = acum(i.id); r.push(a || null, a ? a * n(i.valor_unitario) : null, i.cantidad != null ? n(i.cantidad) - a : null);
      ws.addRow(r);
    };
    const tot = (etq, fn, contr) => { const r = [etq, null, null, null, contr ?? null]; cortes.forEach((k) => r.push(null, fn(k))); r.push(null, fn(null), null); ws.addRow(r).font = { bold: true }; };
    ws.addRow(['ÍTEMS DEL CONTRATO']).font = { bold: true };
    contractuales.forEach(fila);
    tot('Subtotal ítems del contrato', (k) => (k ? subCorte(k, contractuales) : cortes.reduce((a, x) => a + subCorte(x, contractuales), 0)), subContratado);
    if (adicionales.length) {
      ws.addRow(['ADICIONALES']).font = { bold: true };
      adicionales.forEach(fila);
      tot('Subtotal adicionales', (k) => (k ? subCorte(k, adicionales) : cortes.reduce((a, x) => a + subCorte(x, adicionales), 0)));
    }
    tot('TOTAL CORTE', (k) => (k ? n(k.subtotal) : tot2('subtotal')));
    tot('(-) Descuento', (k) => (k ? n(k.descuento) : tot2('descuento')));
    tot('(-) Retenido', (k) => (k ? n(k.valor_retencion) : tot2('valor_retencion')));
    tot('(-) Amortización anticipo', (k) => (k ? n(k.valor_amortizacion) : tot2('valor_amortizacion')));
    tot('TOTAL PAGO', (k) => (k ? n(k.neto) : tot2('neto')));
    ws.columns.forEach((col, idx) => { col.width = idx === 0 ? 60 : 16; if (idx >= 2) col.numFmt = '#,##0.###'; });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `Cortes ${c.numero_contrato}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }
  const tot2 = tot;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-6 space-y-4">
        <Link href={`/contratos/${id}`} className="text-sm text-neutral-500">← Volver al contrato</Link>
        {!d ? <p className="text-sm text-neutral-500">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">Cortes de obra · {c.numero_contrato}</h1>
                <p className="text-sm text-neutral-500">{c.proveedores?.nombre} · {c.concepto} · Valor del contrato {formatoPesos(c.valor_inicial)}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={descargarExcel} className="border border-dorado text-dorado px-4 py-2 rounded text-sm">Descargar Excel</button>
                {(usuario.rol === 'admin' || usuario.rol === 'operativo') && items.length > 0 && (
                  <Link href={`/contratos/${id}/cortes/nuevo`} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">+ Nuevo corte</Link>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm bg-white border rounded-lg p-3">
              <span>Anticipo de obra: <strong>{totalAnticipos ? formatoPesos(totalAnticipos) : 'Sin anticipo'}</strong>{(d.anticipos || []).map((a) => ` · ${a.folio}`).join('')}</span>
              {totalAnticipos > 0 && <span>Por amortizar: <strong>{formatoPesos(saldoAnticipo)}</strong></span>}
              <span>Cortes aprobados: <strong>{cortes.length}</strong></span>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-neutral-500 bg-white border rounded-lg p-6 text-center">Este contrato no tiene ítems cargados. Cárgalos desde el detalle del contrato para empezar a hacer cortes.</p>
            ) : (
              <div className="bg-white rounded-lg border overflow-x-auto">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr className="bg-carbon text-hueso">
                      <th className={`${TH} ${STICKY} bg-carbon text-left`} rowSpan={2}>Ítem</th>
                      <th className={TH} rowSpan={2}>Und</th>
                      <th className={`${TH} border-r border-neutral-600`} colSpan={3}>Contractual</th>
                      {cortes.map((k) => (
                        <th key={k.id} className={`${TH} border-r border-neutral-600`} colSpan={2}>
                          <div>Corte {k.numero}</div>
                          <div className="font-normal text-[10px] text-gris-calido">{fecha(k.fecha)}{k.ordenes_compra?.folio ? ` · ${k.ordenes_compra.folio}` : ' · sin OC'}</div>
                        </th>
                      ))}
                      <th className={TH} colSpan={2}>Acumulado</th>
                      <th className={TH} rowSpan={2}>Saldo</th>
                    </tr>
                    <tr className="bg-gris-calido/40 text-carbon">
                      <th className={TH}>Cant.</th><th className={TH}>Vr. unit.</th><th className={`${TH} border-r`}>Subtotal</th>
                      {cortes.map((k) => (
                        <Fragment key={k.id}><th className={TH}>Cant.</th><th className={`${TH} border-r`}>
                          <button onClick={() => compartirOAbrirArchivo(`/api/cortes/${k.id}/pdf`, `Corte ${k.numero} ${c.numero_contrato}.pdf`)} className="underline text-dorado">Valor (PDF)</button>
                        </th></Fragment>
                      ))}
                      <th className={TH}>Cant.</th><th className={TH}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className={`${STICKY} bg-hueso p-2 text-[11px] font-bold uppercase`} colSpan={1}>Ítems del contrato</td><td colSpan={6 + cortes.length * 2} className="bg-hueso" /></tr>
                    {contractuales.map(filaItem)}
                    {filaTotales('Subtotal ítems del contrato', (k) => $(k ? subCorte(k, contractuales) : cortes.reduce((a, x) => a + subCorte(x, contractuales), 0)), subContratado, 'bg-[#b88a52]/[0.12]')}
                    {adicionales.length > 0 && (
                      <>
                        <tr><td className={`${STICKY} bg-hueso p-2 text-[11px] font-bold uppercase`}>Adicionales</td><td colSpan={6 + cortes.length * 2} className="bg-hueso" /></tr>
                        {adicionales.map(filaItem)}
                        {filaTotales('Subtotal adicionales', (k) => $(k ? subCorte(k, adicionales) : cortes.reduce((a, x) => a + subCorte(x, adicionales), 0)), undefined, 'bg-[#b88a52]/[0.12]')}
                      </>
                    )}
                    {filaTotales('TOTAL CORTE', (k) => $(k ? k.subtotal : tot('subtotal')), undefined, 'bg-hueso')}
                    {cortes.some((k) => n(k.descuento)) && filaTotales('(-) Descuento', (k) => $(k ? k.descuento : tot('descuento')))}
                    {filaTotales('(-) Retenido', (k) => (k ? `${$(k.valor_retencion)}${n(k.porcentaje_retencion) ? ` (${n(k.porcentaje_retencion)}%)` : ''}` : $(tot('valor_retencion'))))}
                    {filaTotales('(-) Amortización anticipo', (k) => $(k ? k.valor_amortizacion : tot('valor_amortizacion')))}
                    {filaTotales('TOTAL PAGO', (k) => $(k ? k.neto : tot('neto')), undefined, 'bg-carbon text-hueso')}
                  </tbody>
                </table>
              </div>
            )}
            {cortes.some((k) => k.notas) && (
              <div className="bg-white border rounded-lg p-3 text-xs text-neutral-600 space-y-1">
                {cortes.filter((k) => k.notas).map((k) => <p key={k.id}><strong>Corte {k.numero}:</strong> {k.notas}</p>)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
