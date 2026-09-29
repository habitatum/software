'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

// ============================================================
// CAJA DIRECTA: libro de movimientos del proyecto (como la hoja CAJA-DIRECTA
// de la V1): FECHA · INGRESO · EGRESO · CONCEPTO · CAPÍTULO · SALDO.
// Solo administradores (incluye lo que paga el cliente).
// ============================================================

const fecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const $ = (v) => (Number(v) ? formatoPesos(Math.round(Number(v))) : '');
const ORIGEN_COLOR = { V1: 'bg-neutral-100 text-neutral-600', Telegram: 'bg-sky-100 text-sky-800', 'Caja menor': 'bg-amber-100 text-amber-800', Corte: 'bg-[#b88a52]/20 text-[#6b4a22]', OC: 'bg-neutral-200 text-neutral-700', App: 'bg-green-100 text-green-800' };

export default function CajaDirecta() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [movs, setMovs] = useState(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState({ tipo: 'TODOS', capitulo: '', texto: '', recientes: true });
  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!esAdmin || !proyecto) return;
    (async () => {
      const { data, error: e } = await crearClienteSupabase().rpc('caja_directa', { p_proyecto: proyecto.id });
      if (e) setError(e.message);
      // Saldo acumulado en orden cronológico (como la columna SALDO de la V1).
      let saldo = 0;
      setMovs((data || []).map((m, i) => { saldo += Number(m.ingreso) - Number(m.egreso); return { ...m, saldo, idx: i }; }));
    })();
  }, [esAdmin, proyecto?.id]); // eslint-disable-line

  const capitulos = useMemo(() => [...new Set((movs || []).map((m) => String(m.capitulo).split('.')[0]))].sort((a, b) => (Number(a) || 999) - (Number(b) || 999) || a.localeCompare(b)), [movs]);
  const visibles = useMemo(() => {
    let l = (movs || []).filter((m) =>
      (filtro.tipo === 'TODOS' || (filtro.tipo === 'INGRESOS' ? Number(m.ingreso) > 0 : Number(m.egreso) > 0)) &&
      (!filtro.capitulo || String(m.capitulo).split('.')[0] === filtro.capitulo || String(m.capitulo).split(', ').some((c) => c.split('.')[0] === filtro.capitulo)) &&
      (!filtro.texto || `${m.concepto} ${m.folio || ''}`.toLowerCase().includes(filtro.texto.toLowerCase())));
    return filtro.recientes ? [...l].reverse() : l;
  }, [movs, filtro]);

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;
  if (!esAdmin) return (<div><NavBar usuario={usuario} proyecto={proyecto} /><main className="p-8 text-center text-neutral-500">Esta sección es solo para administradores.</main></div>);

  const totIng = (movs || []).reduce((a, m) => a + Number(m.ingreso), 0);
  const totEgr = (movs || []).reduce((a, m) => a + Number(m.egreso), 0);
  const filIng = visibles.reduce((a, m) => a + Number(m.ingreso), 0);
  const filEgr = visibles.reduce((a, m) => a + Number(m.egreso), 0);
  const hayFiltro = filtro.tipo !== 'TODOS' || filtro.capitulo || filtro.texto;

  async function descargarExcel() {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CAJA-DIRECTA', { views: [{ state: 'frozen', ySplit: 6, showGridLines: false }] });
    const C = 'FF2E2E2E', D = 'FFB88A52', G = 'FFCEC5BA';
    [12, 16, 16, 70, 12, 12, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 7; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C } };
    try {
      const bytes = new Uint8Array(await (await fetch('/logo-habitatum.png')).arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      ws.addImage(wb.addImage({ base64: btoa(bin), extension: 'png' }), { tl: { col: 0.2, row: 0.2 }, ext: { width: 38, height: 48 } });
    } catch { /* sin logo */ }
    ws.getCell('B1').value = 'HABITATUM'; ws.getCell('B1').font = { size: 18, color: { argb: 'FFFFFFFF' } };
    ws.getCell('B2').value = `Caja directa · ${proyecto.nombre}`; ws.getCell('B2').font = { size: 12, color: { argb: D } };
    ws.getCell('D4').value = `Ingresos ${formatoPesos(Math.round(totIng))} · Egresos ${formatoPesos(Math.round(totEgr))} · Saldo ${formatoPesos(Math.round(totIng - totEgr))}`;
    ws.getCell('D4').font = { bold: true };
    const enc = ws.getRow(6); ['FECHA', 'INGRESO', 'EGRESO', 'CONCEPTO', 'CAPÍTULO', 'ORIGEN', 'SALDO'].forEach((t, i) => { enc.getCell(i + 1).value = t; });
    enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: G } }; c.font = { bold: true }; c.border = { bottom: { style: 'thin', color: { argb: D } } }; });
    const moneda = '_-"$"* #,##0_-;-"$"* #,##0_-;_-"$"* "-"??_-;_-@_-';
    (movs || []).forEach((m) => {
      const row = ws.addRow([fecha(m.fecha), Number(m.ingreso) || null, Number(m.egreso) || null, m.concepto, m.capitulo, m.origen, m.saldo]);
      [2, 3, 7].forEach((i) => { row.getCell(i).numFmt = moneda; });
      row.eachCell((c) => { c.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
    });
    const t = ws.addRow(['TOTAL', totIng, totEgr, '', '', '', totIng - totEgr]);
    [2, 3, 7].forEach((i) => { t.getCell(i).numFmt = moneda; });
    t.eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: G } }; });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `Caja directa - ${proyecto.nombre}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-6xl mx-auto space-y-4">
        <Link href="/caja" className="text-sm text-neutral-500">← Volver a Caja</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Caja directa</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre} · Todos los ingresos y egresos del proyecto · Solo administradores</p>
          </div>
          {movs && <button onClick={descargarExcel} className="border border-dorado text-dorado px-4 py-2 rounded text-sm">Descargar Excel</button>}
        </div>
        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}
        {!movs ? <p className="text-sm text-neutral-500">Cargando movimientos…</p> : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white border rounded-lg p-3 border-t-2 border-t-dorado"><p className="text-[11px] uppercase text-neutral-500">Ingresos</p><p className="font-semibold text-green-700">{formatoPesos(Math.round(totIng))}</p></div>
              <div className="bg-white border rounded-lg p-3 border-t-2 border-t-dorado"><p className="text-[11px] uppercase text-neutral-500">Egresos</p><p className="font-semibold text-red-700">{formatoPesos(Math.round(totEgr))}</p></div>
              <div className="bg-carbon text-hueso rounded-lg p-3 border-t-2 border-t-dorado"><p className="text-[11px] uppercase text-gris-calido">Saldo en libros</p><p className="font-semibold">{formatoPesos(Math.round(totIng - totEgr))}</p></div>
            </div>

            <div className="bg-white border rounded-lg p-3 flex flex-wrap gap-2 items-center text-sm">
              <select value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })} className="border rounded px-2 py-1">
                <option value="TODOS">Ingresos y egresos</option><option value="INGRESOS">Solo ingresos</option><option value="EGRESOS">Solo egresos</option>
              </select>
              <select value={filtro.capitulo} onChange={(e) => setFiltro({ ...filtro, capitulo: e.target.value })} className="border rounded px-2 py-1">
                <option value="">Todos los capítulos</option>
                {capitulos.map((c) => <option key={c} value={c}>{/^\d+$/.test(c) ? `Capítulo ${c}` : c}</option>)}
              </select>
              <input value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} placeholder="Buscar concepto, proveedor u OC…" className="border rounded px-2 py-1 flex-1 min-w-[180px]" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={filtro.recientes} onChange={(e) => setFiltro({ ...filtro, recientes: e.target.checked })} /> Más recientes primero</label>
              {hayFiltro && <span className="text-xs text-neutral-500 w-full">{visibles.length} movimientos · ingresos {formatoPesos(Math.round(filIng))} · egresos {formatoPesos(Math.round(filEgr))}</span>}
            </div>

            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#cec5ba] text-left text-xs">
                  <tr><th className="p-2">Fecha</th><th className="p-2 text-right">Ingreso</th><th className="p-2 text-right">Egreso</th><th className="p-2">Concepto</th><th className="p-2">Capítulo</th><th className="p-2">Origen</th><th className="p-2 text-right">Saldo</th></tr>
                </thead>
                <tbody>
                  {visibles.map((m) => (
                    <tr key={m.idx} className="border-t hover:bg-hueso/50">
                      <td className="p-2 text-xs whitespace-nowrap">{fecha(m.fecha)}</td>
                      <td className="p-2 text-xs text-right whitespace-nowrap text-green-700 font-semibold">{$(m.ingreso)}</td>
                      <td className="p-2 text-xs text-right whitespace-nowrap text-red-700">{$(m.egreso)}</td>
                      <td className="p-2 text-xs min-w-[260px]">{m.concepto}</td>
                      <td className="p-2 text-xs whitespace-nowrap">{m.capitulo}</td>
                      <td className="p-2 text-xs"><span className={`px-1.5 py-0.5 rounded text-[10px] ${ORIGEN_COLOR[m.origen] || ''}`}>{m.origen}</span></td>
                      <td className="p-2 text-xs text-right whitespace-nowrap font-semibold">{formatoPesos(Math.round(m.saldo))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-neutral-500">
              Incluye: ingresos del cliente, retiros de utilidad y ajustes · pagos del formato anterior (V1) · Órdenes de Compra pagadas desde la caja
              (cortes, facturas de Telegram, caja menor legalizada) · caja menor por legalizar. No incluye lo que el cliente paga directamente.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
