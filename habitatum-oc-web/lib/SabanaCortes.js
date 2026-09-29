'use client';
import { Fragment, useState } from 'react';
import { formatoPesos } from '@/lib/calculosOC';

// ============================================================
// Sábana de cortes — réplica del Excel de cortes de obra.
// Columnas: ÍTEM | DESCRIPCIÓN | UNIDAD | CANTIDAD | VALOR UNIT | SUBTOTAL
//           CORTE N: Cantidad | Valor Unit | SUBTOTAL   (uno por corte)
//           ACUMULADOS TOTALES CORTES: Cantidad | Valor Unit | SUBTOTAL
// Filas de cierre: SUBTOTAL CORTE N · SUBTOTAL ADIC. CORTE N · TOTAL CORTE N ·
// (-) Retenido · ANTICIPO DE OBRA / (-) Amortización · TOTAL PAGO CORTE N.
// Si llega `edicion`, la columna del corte nuevo es editable (como agregar una
// columna en el Excel) y los adicionales nuevos se agregan con "Agregar".
// ============================================================

const GRIS = 'bg-[#cec5ba]';
const EDIT = 'bg-[#b88a52]/[0.14]';
const cant = (v) => (v ? Number(v).toLocaleString('es-CO', { maximumFractionDigits: 3 }) : '');
const $ = (v) => (Number(v) ? formatoPesos(Math.round(Number(v) * 100) / 100) : '$ -');
const fecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const TD = 'px-2 py-1.5 text-xs whitespace-nowrap';
const LINEA = 'w-2 bg-white border-r border-[#cec5ba]';
const SEP = <td className={LINEA} />;

export default function SabanaCortes({ m, contrato, edicion, onPdf }) {
  const cols = m.columnas;
  const [nuevo, setNuevo] = useState({ descripcion: '', unidad: '', valor_unitario: '', capitulo_id: '', cantidad: '' });

  function agregar() {
    if (!nuevo.descripcion.trim() || !(Number(nuevo.valor_unitario) > 0) || !nuevo.capitulo_id) {
      window.alert('El adicional necesita descripción, valor unitario y capítulo del presupuesto.');
      return;
    }
    edicion.onAgregarNuevo({ ...nuevo, tmpId: Date.now() });
    setNuevo({ descripcion: '', unidad: '', valor_unitario: '', capitulo_id: '', cantidad: '' });
  }

  function celdasCorte(col, item) {
    const q = col.cantidad(item.id);
    const vu = Number(item.valor_unitario);
    if (col.editable) {
      const valorInput = String(item.id).startsWith('nuevo:')
        ? (edicion.nuevos.find((x) => `nuevo:${x.tmpId}` === item.id)?.cantidad ?? '')
        : (edicion.cantidades[item.id] ?? '');
      return (
        <Fragment key={col.id}>
          {SEP}
          <td className={`p-1 ${EDIT}`}>
            <input type="number" step="any" disabled={!edicion.puedeEditar} value={valorInput} placeholder="0"
              onChange={(e) => (String(item.id).startsWith('nuevo:') ? edicion.onCantidadNuevo(item.tmpId, e.target.value) : edicion.onCantidad(item.id, e.target.value))}
              className="border rounded px-1.5 py-0.5 text-xs w-20 text-right bg-white" />
          </td>
          <td className={`${TD} text-right ${EDIT}`}>{$(vu)}</td>
          <td className={`${TD} text-right font-semibold ${EDIT}`}>{q ? $(q * vu) : '$ -'}</td>
        </Fragment>
      );
    }
    return (
      <Fragment key={col.id}>
        {SEP}
        <td className={`${TD} text-right`}>{cant(q)}</td>
        <td className={`${TD} text-right text-neutral-500`}>{$(vu)}</td>
        <td className={`${TD} text-right`}>{q ? $(q * vu) : '$ -'}</td>
      </Fragment>
    );
  }

  function filaItem(item, contractual) {
    const aq = m.acumulado.cantidad(item.id);
    const excede = m.excede(item);
    return (
      <tr key={item.id} className="border-b border-neutral-200 hover:bg-hueso/40">
        <td className={`${TD} font-semibold`}>{item.codigo || (contractual ? '' : 'AD')}</td>
        <td className="px-2 py-1.5 text-xs min-w-[280px] max-w-[380px]">
          {item.descripcion}
          {item.es_nuevo && edicion?.puedeEditar && (
            <button onClick={() => edicion.onQuitarNuevo(item.tmpId)} className="ml-2 text-[10px] text-red-600 underline">quitar</button>
          )}
          {item.es_nuevo && <span className="ml-2 text-[10px] text-dorado font-semibold">NUEVO</span>}
        </td>
        <td className={TD}>{item.unidad}</td>
        <td className={`${TD} text-right`}>{contractual ? cant(item.cantidad) : ''}</td>
        <td className={`${TD} text-right`}>{$(item.valor_unitario)}</td>
        <td className={`${TD} text-right`}>{contractual ? $(Number(item.cantidad) * Number(item.valor_unitario)) : ''}</td>
        {cols.map((c) => celdasCorte(c, item))}
        {SEP}
        <td className={`${TD} text-right ${excede ? 'text-red-700 font-bold' : ''}`}>{cant(aq)}</td>
        <td className={`${TD} text-right text-neutral-500`}>{$(item.valor_unitario)}</td>
        <td className={`${TD} text-right font-semibold`}>{aq ? $(aq * Number(item.valor_unitario)) : '$ -'}</td>
      </tr>
    );
  }

  // Fila de cierre: etiqueta en (Cantidad+Valor Unit) de cada corte y valor en SUBTOTAL, como en el Excel.
  function filaCierre({ izquierda, valorIzq, etiquetaCorte, valorCorte, etiquetaAcum, valorAcum, gris, controlEdicion }) {
    return (
      <tr className="border-b border-neutral-200">
        <td className={TD} />
        <td className={`${TD} font-semibold`}>{izquierda || ''}</td>
        <td className={TD} colSpan={3} />
        <td className={`${TD} text-right font-bold ${valorIzq !== undefined ? GRIS : ''}`}>{valorIzq !== undefined ? $(valorIzq) : ''}</td>
        {cols.map((c) => (
          <Fragment key={c.id}>
            {SEP}
            <td className={`${TD} font-bold ${gris ? GRIS : ''} ${c.editable ? EDIT : ''}`} colSpan={2}>
              {etiquetaCorte(c)}{c.editable && controlEdicion ? controlEdicion : null}
            </td>
            <td className={`${TD} text-right font-bold ${GRIS} ${c.editable ? 'ring-1 ring-inset ring-dorado' : ''}`}>{$(valorCorte(c))}</td>
          </Fragment>
        ))}
        {SEP}
        <td className={`${TD} font-bold ${gris ? GRIS : ''}`} colSpan={2}>{etiquetaAcum}</td>
        <td className={`${TD} text-right font-bold ${GRIS}`}>{$(valorAcum)}</td>
      </tr>
    );
  }

  const encabezadoSeccion = (titulo) => (
    <tr>
      <td className={`${TD} font-bold ${GRIS}`} colSpan={6}>{titulo}</td>
      {cols.map((c) => <Fragment key={c.id}>{SEP}<td className={`${TD} font-bold ${GRIS} ${c.editable ? 'text-dorado' : ''}`} colSpan={3}>{titulo}</td></Fragment>)}
      {SEP}
      <td className={`${TD} font-bold ${GRIS}`} colSpan={3}>{titulo}</td>
    </tr>
  );
  const filaVacia = (
    <tr className="h-3">
      <td colSpan={6} />
      {cols.map((c) => <Fragment key={c.id}>{SEP}<td colSpan={3} /></Fragment>)}
      {SEP}<td colSpan={3} />
    </tr>
  );

  return (
    <div className="bg-white rounded-lg border overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            <th className={`${TD} ${GRIS} text-left`} colSpan={6}>ITEMS Y ELEMENTOS CONTRACTUALES (APROBADOS)</th>
            {cols.map((c) => (
              <Fragment key={c.id}>
                <th className={LINEA} />
                <th className={`${TD} text-center ${c.editable ? 'bg-carbon text-hueso' : GRIS}`} colSpan={3}>
                  CORTE {c.numero}{c.editable ? ` · ${c.titulo}` : ''}
                  <div className="font-normal text-[10px]">
                    {fecha(c.fecha)}{c.folio ? ` · ${c.folio}` : c.editable ? '' : ' · sin OC'}
                    {!c.editable && onPdf && <> · <button onClick={() => onPdf(c)} className="underline">PDF</button></>}
                  </div>
                </th>
              </Fragment>
            ))}
            <th className={LINEA} />
            <th className={`${TD} ${GRIS} text-center`} colSpan={3}>ACUMULADOS TOTALES CORTES</th>
          </tr>
          <tr className={`${GRIS} text-left`}>
            <th className={TD}>Ítem</th>
            <th className={`${TD}`}>Descripción</th>
            <th className={TD}>Unidad</th><th className={`${TD} text-right`}>Cantidad</th>
            <th className={`${TD} text-right`}>Valor Unit</th><th className={`${TD} text-right`}>SUBTOTAL</th>
            {cols.map((c) => (
              <Fragment key={c.id}>
                <th className={LINEA} />
                <th className={`${TD} text-right ${c.editable ? 'bg-carbon text-hueso' : ''}`}>Cantidad</th>
                <th className={`${TD} text-right ${c.editable ? 'bg-carbon text-hueso' : ''}`}>Valor Unit</th>
                <th className={`${TD} text-right ${c.editable ? 'bg-carbon text-hueso' : ''}`}>SUBTOTAL</th>
              </Fragment>
            ))}
            <th className={LINEA} />
            <th className={`${TD} text-right`}>Cantidad</th><th className={`${TD} text-right`}>Valor Unit</th><th className={`${TD} text-right`}>SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>
          {m.contractuales.map((i) => filaItem(i, true))}
          {filaCierre({
            valorIzq: m.subtotalContratado,
            etiquetaCorte: (c) => `SUBTOTAL CORTE ${c.numero}`, valorCorte: (c) => c.subContrato,
            etiquetaAcum: 'SUBTOTAL CORTES', valorAcum: m.acumulado.subContrato,
          })}
          {filaVacia}
          {encabezadoSeccion('ADICIONALES')}
          {m.adicionales.map((i) => filaItem(i, false))}
          {edicion?.puedeEditar && (
            <tr className="border-b border-dorado/50 bg-[#b88a52]/[0.06]">
              <td className={`${TD} font-semibold text-dorado`}>AD</td>
              <td className="p-1">
                <input value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} placeholder="Nuevo adicional: descripción" className="border rounded px-1.5 py-0.5 text-xs w-full" />
                <select value={nuevo.capitulo_id} onChange={(e) => setNuevo({ ...nuevo, capitulo_id: e.target.value })} className="border rounded px-1 py-0.5 text-[11px] w-full mt-1">
                  <option value="">Capítulo del presupuesto…</option>
                  {(edicion.capitulos || []).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                </select>
              </td>
              <td className="p-1"><input value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} placeholder="Und" className="border rounded px-1 py-0.5 text-xs w-14" /></td>
              <td />
              <td className="p-1"><input type="number" value={nuevo.valor_unitario} onChange={(e) => setNuevo({ ...nuevo, valor_unitario: e.target.value })} placeholder="Valor unit." className="border rounded px-1 py-0.5 text-xs w-24 text-right" /></td>
              <td className="p-1"><button onClick={agregar} className="bg-carbon text-hueso rounded px-3 py-1 text-xs whitespace-nowrap">Agregar ✓</button></td>
              {cols.map((c) => (
                <Fragment key={c.id}>
                  {SEP}
                  {c.editable
                    ? <td className={`p-1 ${EDIT}`} colSpan={3}><input type="number" step="any" value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value })} placeholder="Cantidad en este corte" className="border rounded px-1.5 py-0.5 text-xs w-full text-right bg-white" /></td>
                    : <td colSpan={3} />}
                </Fragment>
              ))}
              {SEP}<td colSpan={3} />
            </tr>
          )}
          {filaCierre({
            etiquetaCorte: (c) => `SUBTOTAL ADIC. CORTE ${c.numero}`, valorCorte: (c) => c.subAdicionales,
            etiquetaAcum: 'ACUMULADO ADICIONALES', valorAcum: m.acumulado.subAdicionales,
          })}
          {filaVacia}
          {filaCierre({
            etiquetaCorte: (c) => `TOTAL CORTE ${c.numero}`, valorCorte: (c) => c.total,
            etiquetaAcum: 'TOTAL CORTES', valorAcum: m.acumulado.total,
          })}
          {cols.some((c) => c.descuento) && filaCierre({
            etiquetaCorte: () => '(-) Descuento', valorCorte: (c) => c.descuento,
            etiquetaAcum: '(-) TOTAL DESCUENTOS', valorAcum: m.acumulado.descuento,
          })}
          {filaCierre({
            etiquetaCorte: (c) => (c.editable ? '(-) Retenido ' : `(-) Retenido ${c.pctRetencion}%`),
            valorCorte: (c) => c.retencion,
            etiquetaAcum: '(-) TOTAL RETENIDO', valorAcum: m.acumulado.retencion,
            controlEdicion: edicion ? (
              <span className="inline-flex items-center gap-1">
                <input type="number" step="any" disabled={!edicion.puedeEditar} value={edicion.pctRetencionTexto} onChange={(e) => edicion.onPctRetencion(e.target.value)}
                  className="border rounded px-1 py-0.5 text-xs w-14 text-right bg-white" />%
              </span>
            ) : null,
          })}
          {filaCierre({
            izquierda: m.totalAnticipos ? `ANTICIPO DE OBRA (${m.pctAnticipo}%)` : 'ANTICIPO DE OBRA',
            valorIzq: m.totalAnticipos,
            etiquetaCorte: (c) => `(-) Amortización Anticipo${c.pctAmortizacion ? ` ${c.pctAmortizacion}%` : ''}`,
            valorCorte: (c) => c.amortizacion,
            etiquetaAcum: '(+) TOTAL POR AMORTIZAR', valorAcum: m.acumulado.porAmortizar,
          })}
          {filaCierre({
            etiquetaCorte: (c) => `TOTAL PAGO CORTE ${c.numero}`, valorCorte: (c) => c.neto,
            etiquetaAcum: 'TOTAL PAGADO', valorAcum: m.acumulado.pagado, gris: true,
          })}
        </tbody>
      </table>
    </div>
  );
}
