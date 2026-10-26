'use client';
import { Fragment } from 'react';
import { formatoPesos } from '@/lib/calculosOC';
import { fechaCC, cantCC } from '@/lib/cortesCliente';

// Cortes al cliente (todo costo) · 074: cuadro único con la estructura del Excel del control presupuestal de
// administración delegada. Todos los capítulos e ítems; un bloque Cantidad · Vr parcial por corte (los cerrados
// solo lectura, el abierto editable), el acumulado y el avance; al final totales, pagos del cliente y saldo.
const pesos = (v) => formatoPesos(Math.round(Number(v) || 0));
const pct1 = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-CO')}%`;
const COL_CORTE = 'bg-[#f3e9dc]';

// ---------- Cuadro único de control (074) ----------
const TH = 'p-2 text-right font-semibold whitespace-nowrap';
const TD = 'p-2 text-right tabular-nums whitespace-nowrap';
// Descripción fija al desplazar a la derecha solo desde tablet; en el celular ocuparía toda la pantalla.
const STICKY = 'sm:sticky left-0 z-10';
const cantOGuion = (v) => (Number(v) ? cantCC(Math.round(Number(v) * 1000) / 1000) : '—');
const pesosOGuion = (v) => (Math.round(Number(v) || 0) ? pesos(v) : '—');

export default function TablaControlCorteCliente({ calc, abierto, edic, setCap, setItem, cerrados, setCerrados, final }) {
  const cortes = calc.numerosCortes?.length ? calc.numerosCortes : [calc.corte.numero];
  const kAct = cortes.indexOf(calc.corte.numero);
  const fechaDe = (n) => (calc.cortes || []).find((x) => x.numero === n)?.fecha;
  const nCols = 10 + 2 * cortes.length;
  const fondoCorte = (k) => (k === kAct ? COL_CORTE : '');
  const bordeBloque = 'border-l-4 border-l-white';
  const todosCerrados = calc.capitulos.every((c) => cerrados[c.id]);
  const filaTotal = (etq, base, porCorte, acum, cls, { pct = true } = {}) => (
    <tr className={cls}>
      <td className={`p-2 ${STICKY} ${cls}`} colSpan={2}>{etq}</td>
      <td className="p-2" colSpan={3} />
      <td className={TD}>{base !== null ? pesos(base) : ''}</td>
      {cortes.map((n, k) => (
        <Fragment key={n}><td className={`p-2 ${bordeBloque}`} /><td className={TD}>{porCorte ? pesos(porCorte[k]) : ''}</td></Fragment>
      ))}
      <td className={`p-2 ${bordeBloque}`} /><td className={TD}>{pesos(acum)}</td>
      <td className={`${TD} ${bordeBloque}`}>{pct && base ? pct1((acum / base) * 100) : ''}</td>
      <td className={TD}>{pct && base !== null ? pesos(base - acum) : ''}</td>
    </tr>
  );
  return (
    <div className="bg-white rounded-lg border">
      <div className="flex justify-end px-3 pt-2">
        <button type="button" onClick={() => setCerrados(todosCerrados ? {} : Object.fromEntries(calc.capitulos.map((c) => [c.id, true])))}
          className="text-xs text-neutral-600 hover:text-dorado">{todosCerrados ? '▾ Ver todos los ítems' : '▸ Ver solo capítulos'}</button>
      </div>
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
        <table className="text-xs border-separate border-spacing-0 min-w-full">
          <thead className="sticky top-0 z-20">
            <tr className="text-hueso">
              <th className={`p-2 text-left bg-dorado ${STICKY} z-30`} colSpan={2} rowSpan={2}>Ítem · Descripción</th>
              <th className="p-2 bg-dorado" rowSpan={2}>Und</th>
              <th className="p-2 bg-dorado text-center" colSpan={3}>CONTRATADO</th>
              {cortes.map((n, k) => (
                <th key={n} colSpan={2} className={`p-2 text-center ${bordeBloque} ${k === kAct && abierto ? 'bg-[#6b4a22]' : 'bg-carbon'}`}>
                  CORTE {n}{fechaDe(n) ? ` · ${fechaCC(fechaDe(n))}` : ''}{k === kAct ? (abierto ? ' · ABIERTO' : '') : ' · cerrado'}
                </th>
              ))}
              <th colSpan={2} className={`p-2 text-center bg-dorado ${bordeBloque}`}>ACUMULADO</th>
              <th colSpan={2} className={`p-2 text-center bg-carbon ${bordeBloque}`}>AVANCE</th>
            </tr>
            <tr className="bg-gris-calido text-carbon">
              <th className={TH}>Cant.</th><th className={TH}>Vr. unit.</th><th className={TH}>Vr. parcial</th>
              {cortes.map((n, k) => (
                <Fragment key={n}><th className={`${TH} ${bordeBloque} ${fondoCorte(k)}`}>Cant.</th><th className={`${TH} ${fondoCorte(k)}`}>Vr. parcial</th></Fragment>
              ))}
              <th className={`${TH} ${bordeBloque}`}>Cant.</th><th className={TH}>Vr. parcial</th>
              <th className={`${TH} ${bordeBloque}`}>%</th><th className={TH}>{final ? 'Pendiente / (exceso)' : 'Por ejecutar'}</th>
            </tr>
          </thead>
          <tbody>
            {calc.grupos.map((g) => (
              <Fragment key={g.clave}>
                <tr className="bg-carbon text-hueso">
                  <td colSpan={nCols} className="px-2 py-1.5 font-semibold uppercase tracking-wide">
                    <span className="sticky left-2">{g.titulo}{g.suma ? '' : ' · informativo, no suma'}</span>
                  </td>
                </tr>
                {g.capitulos.map((c) => {
                  const ver = !cerrados[c.id];
                  const global = c.modo === 'GLOBAL';
                  return (
                    <Fragment key={c.id}>
                      <tr className={`bg-gris-calido/50 font-semibold ${g.suma ? '' : 'italic text-neutral-600'}`}>
                        <td className={`p-2 align-top ${STICKY} bg-[#e8e2d9] min-w-[260px] sm:min-w-[320px] max-w-[320px]`} colSpan={2}>
                          <button type="button" onClick={() => setCerrados((p) => ({ ...p, [c.id]: !p[c.id] }))} className="text-left hover:text-dorado">
                            <span className="text-neutral-400 mr-1">{ver ? '▾' : '▸'}</span>{c.codigo} · {c.nombre}
                          </button>
                          <div className="mt-1 inline-flex rounded border overflow-hidden not-italic font-normal ml-4">
                            {[['CANTIDAD', 'Cantidades'], ['GLOBAL', 'Global %']].map(([m, t]) => (
                              <button key={m} type="button" disabled={!abierto} onClick={() => setCap(c.id, { modo: m })}
                                className={`px-2 py-0.5 ${c.modo === m ? 'bg-carbon text-hueso' : 'bg-white text-neutral-600'} disabled:cursor-default`}>{t}</button>
                            ))}
                          </div>
                        </td>
                        <td className="p-2" colSpan={3} />
                        <td className={TD}>{pesos(c.contratado)}</td>
                        {cortes.map((n, k) => {
                          const h = c.porCorte[k] || { valor: 0, pct: 0 };
                          const modoK = k === kAct ? c.modo : ((c.historia || []).find((x) => x.numero === n)?.modo || c.modo);
                          return (
                            <Fragment key={n}>
                              <td className={`${TD} ${bordeBloque} ${fondoCorte(k)} font-normal`}>
                                {k === kAct && global && abierto ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <span>+</span>
                                    <input type="number" inputMode="decimal" min="0" max="100" step="any"
                                      value={edic.caps[c.id]?.pctEste ?? String(Math.round((Number(c.porcentaje) - c.pctAnterior) * 10000) / 10000)}
                                      onChange={(e) => setCap(c.id, { pctEste: e.target.value, porcentaje: c.pctAnterior + (Number(e.target.value) || 0) })}
                                      className="w-16 border rounded px-1.5 py-1 text-right bg-white" />
                                    <span>%</span>
                                  </div>
                                ) : (modoK === 'GLOBAL' && h.pct ? pct1(h.pct) : '')}
                              </td>
                              <td className={`${TD} ${fondoCorte(k)}`}>{pesosOGuion(h.valor)}</td>
                            </Fragment>
                          );
                        })}
                        <td className={`${TD} ${bordeBloque} font-normal`}>{global ? `${pct1(c.porcentaje)}` : ''}</td>
                        <td className={TD}>{pesos(c.acumulado)}</td>
                        <td className={`${TD} ${bordeBloque}`}>{pct1(c.avance)}{global && Number(c.porcentaje) > 100.0001 && <span className="block text-red-700">pasa del 100 %</span>}</td>
                        <td className={`${TD} ${c.contratado - c.acumulado < 0 ? 'text-red-700' : ''}`}>{pesos(c.contratado - c.acumulado)}</td>
                      </tr>
                      {ver && c.items.map((it) => (
                        <tr key={it.id} className="bg-white hover:bg-hueso/50">
                          <td className={`p-2 align-top ${STICKY} bg-white text-neutral-500 border-b border-neutral-100 min-w-[60px] max-w-[60px]`}>{it.codigo}</td>
                          <td className="p-2 align-top min-w-[200px] sm:min-w-[260px] max-w-[260px] border-b border-neutral-100 sm:sticky left-[60px] z-10 bg-white">{it.descripcion}</td>
                          <td className="p-2 border-b border-neutral-100">{it.unidad || ''}</td>
                          <td className={`${TD} border-b border-neutral-100`}>{cantCC(it.contratado)}</td>
                          <td className={`${TD} border-b border-neutral-100`}>{pesos(it.valor_unitario)}</td>
                          <td className={`${TD} border-b border-neutral-100`}>{pesos(it.valor_contratado)}</td>
                          {cortes.map((n, k) => {
                            const h = it.porCorte[k] || { cantidad: 0, valor: 0 };
                            const editable = k === kAct && abierto && !global;
                            const falta = Number(it.contratado) - Number(it.anterior);
                            return (
                              <Fragment key={n}>
                                <td className={`${TD} ${bordeBloque} ${fondoCorte(k)} border-b border-neutral-100`}>
                                  {editable ? (
                                    <div className="flex items-center justify-end gap-1">
                                      <input type="number" inputMode="decimal" step="any" value={it.este === 0 ? '' : it.este}
                                        placeholder="0" onChange={(e) => setItem(it.id, e.target.value)}
                                        className="w-16 border rounded px-1.5 py-1 text-right bg-white" />
                                      {falta > 0 && Number(it.este) !== Math.round(falta * 1000) / 1000 && (
                                        <button type="button" title="Completar lo que falta del ítem"
                                          onClick={() => setItem(it.id, String(Math.round(falta * 1000) / 1000))}
                                          className="text-[10px] border border-dorado text-[#6b4a22] rounded px-1 py-0.5">Todo</button>
                                      )}
                                    </div>
                                  ) : cantOGuion(h.cantidad)}
                                </td>
                                <td className={`${TD} ${fondoCorte(k)} border-b border-neutral-100`}>{pesosOGuion(h.valor)}</td>
                              </Fragment>
                            );
                          })}
                          <td className={`${TD} ${bordeBloque} border-b border-neutral-100 ${it.excede ? 'text-red-700 font-semibold' : ''}`}>{cantOGuion(it.acumulado)}</td>
                          <td className={`${TD} border-b border-neutral-100`}>{pesosOGuion(it.valor_acumulado)}</td>
                          <td className={`${TD} ${bordeBloque} border-b border-neutral-100`}>{Number(it.valor_contratado) ? pct1((it.valor_acumulado / Number(it.valor_contratado)) * 100) : '—'}</td>
                          <td className={`${TD} border-b border-neutral-100`}>{pesosOGuion(Number(it.valor_contratado) - it.valor_acumulado)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {filaTotal(`Total ${g.titulo.toLowerCase()}`, g.contratado, g.porCorte.map((h) => h.valor), g.acumulado, 'bg-hueso font-semibold')}
              </Fragment>
            ))}
            {filaTotal(`VALOR TOTAL ${final ? 'LIQUIDADO' : 'DEL CORTE'} (contrato + adicionales)`, calc.tot.contratado, calc.tot.porCorte.map((h) => h.valor), calc.tot.acumulado, 'bg-dorado text-white font-bold')}
            {filaTotal('(−) Pagos recibidos del cliente', null, null, calc.tot.pagos, 'bg-green-50 text-green-900 font-semibold', { pct: false })}
            {filaTotal(calc.tot.saldo < 0 ? 'Saldo a favor del cliente' : 'SALDO A PAGAR POR EL CLIENTE', null, null, Math.abs(calc.tot.saldo), 'bg-carbon text-hueso font-bold', { pct: false })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
