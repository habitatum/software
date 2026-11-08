'use client';
import { useState } from 'react';
import { formatoPesos } from '@/lib/calculosOC';
import { CARGOS_PERSONAL, nombreCargo, totalesPersonal } from '@/lib/personalCortes';

// 077 · Soporte de personal por administración del corte: registro día a día y totales por cargo.
// Con `editable`, las filas se escriben aquí y el total de horas de cada cargo llena la cantidad del ítem
// del contrato asociado en la sábana (esas casillas quedan bloqueadas mientras haya registros).
const CAMPO = 'border rounded px-2 py-1 text-xs bg-white';
const fecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const horas = (v) => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });

export default function SoportePersonal({ filas, setFilas, mapeo, setMapeo, items, vu, editable, fechaCorte }) {
  const [abierto, setAbierto] = useState((filas || []).length > 0);
  const tot = totalesPersonal(filas, mapeo);
  const itemsSel = (items || []);
  const descItem = (id) => { const it = itemsSel.find((i) => i.id === id); return it ? `${it.codigo ? `${it.codigo} · ` : ''}${it.descripcion} (${it.unidad || '—'})` : ''; };
  const cargosUsados = CARGOS_PERSONAL.filter((c) => tot.porCargo[c.id] > 0 || (editable && mapeo?.[c.id]));
  const setFila = (k, campo, v) => setFilas(filas.map((f, j) => (j === k ? { ...f, [campo]: v } : f)));
  function agregar() {
    const ult = filas[filas.length - 1];
    setFilas([...filas, { nombre: '', cargo: ult?.cargo || 'OFICIAL_HO', fecha: ult?.fecha || fechaCorte || new Date().toISOString().slice(0, 10), horas: ult?.horas || '8' }]);
    setAbierto(true);
  }
  if (!editable && !(filas || []).length) return null;
  return (
    <div className="bg-white rounded-lg border">
      <button type="button" onClick={() => setAbierto(!abierto)} className="w-full flex justify-between items-center px-4 py-3 text-left">
        <span className="font-medium text-sm">👷 Soporte de personal por administración
          <span className="ml-2 text-xs text-neutral-500 font-normal">{filas.length ? `${filas.length} registro(s) · ${horas(tot.total)} h` : 'sin registros'}</span>
        </span>
        <span className="text-neutral-400 text-xs">{abierto ? '▾ ocultar' : '▸ ver'}</span>
      </button>
      {abierto && (
        <div className="px-4 pb-4 space-y-4">
          {editable && (
            <p className="text-xs text-neutral-500">Registre cada día trabajado (el nombre es opcional). El total de horas de cada cargo pasa solo a la cantidad del ítem del contrato que se le asigne abajo.</p>
          )}
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[560px] w-full">
              <thead>
                <tr className="bg-gris-calido text-carbon">
                  <th className="p-2 text-left w-8">#</th>
                  <th className="p-2 text-left">Nombre (opcional)</th>
                  <th className="p-2 text-left">Cargo</th>
                  <th className="p-2 text-left">Día laborado</th>
                  <th className="p-2 text-right">Horas</th>
                  {editable && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, k) => (
                  <tr key={k} className="border-b border-neutral-100">
                    <td className="p-1.5 text-neutral-400">{k + 1}</td>
                    <td className="p-1.5">{editable ? <input value={f.nombre || ''} onChange={(e) => setFila(k, 'nombre', e.target.value)} placeholder="—" className={`${CAMPO} w-full min-w-[140px]`} /> : (f.nombre || '—')}</td>
                    <td className="p-1.5">{editable ? (
                      <select value={f.cargo} onChange={(e) => setFila(k, 'cargo', e.target.value)} className={CAMPO}>
                        {CARGOS_PERSONAL.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>) : nombreCargo(f.cargo)}</td>
                    <td className="p-1.5">{editable ? <input type="date" value={f.fecha || ''} onChange={(e) => setFila(k, 'fecha', e.target.value)} className={CAMPO} /> : fecha(f.fecha)}</td>
                    <td className="p-1.5 text-right">{editable ? <input type="number" inputMode="decimal" step="any" min="0" max="24" value={f.horas} onChange={(e) => setFila(k, 'horas', e.target.value)} className={`${CAMPO} w-20 text-right`} /> : horas(f.horas)}</td>
                    {editable && <td className="p-1.5 text-right"><button type="button" onClick={() => setFilas(filas.filter((_, j) => j !== k))} className="text-red-600 underline text-[11px]">quitar</button></td>}
                  </tr>
                ))}
                {!filas.length && <tr><td colSpan={6} className="p-3 text-neutral-400">Sin registros de personal en este corte.</td></tr>}
              </tbody>
            </table>
          </div>
          {editable && <button type="button" onClick={agregar} className="text-xs border border-dorado text-[#6b4a22] rounded px-3 py-1.5">+ Agregar registro</button>}

          <div className="overflow-x-auto">
            <table className="text-xs min-w-[560px] w-full">
              <thead>
                <tr className="bg-carbon text-hueso">
                  <th className="p-2 text-left">Cargo</th>
                  <th className="p-2 text-right">Total horas</th>
                  <th className="p-2 text-left">Ítem del contrato (cantidad del corte)</th>
                  <th className="p-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(editable ? CARGOS_PERSONAL.filter((c) => tot.porCargo[c.id] > 0 || mapeo?.[c.id]) : cargosUsados).map((c) => {
                  const it = mapeo?.[c.id];
                  const falta = tot.porCargo[c.id] > 0 && !it;
                  return (
                    <tr key={c.id} className={`border-b border-neutral-100 ${falta ? 'bg-red-50' : ''}`}>
                      <td className="p-2 font-medium">{c.nombre}</td>
                      <td className="p-2 text-right tabular-nums">{horas(tot.porCargo[c.id])}</td>
                      <td className="p-2">{editable ? (
                        <select value={it || ''} onChange={(e) => setMapeo({ ...mapeo, [c.id]: e.target.value })} className={`${CAMPO} w-full max-w-[420px]`}>
                          <option value="">{falta ? '⚠️ Elija el ítem del contrato…' : 'Sin ítem'}</option>
                          {itemsSel.map((i) => <option key={i.id} value={i.id}>{i.codigo ? `${i.codigo} · ` : ''}{i.descripcion} ({i.unidad || '—'})</option>)}
                        </select>) : (descItem(it) || '—')}</td>
                      <td className="p-2 text-right tabular-nums">{it ? formatoPesos(Math.round(tot.porCargo[c.id] * (vu ? vu(it) : 0))) : '—'}</td>
                    </tr>
                  );
                })}
                <tr className="bg-hueso font-semibold">
                  <td className="p-2">Total</td>
                  <td className="p-2 text-right tabular-nums">{horas(tot.total)}</td>
                  <td className="p-2" />
                  <td className="p-2 text-right tabular-nums">{formatoPesos(Math.round(CARGOS_PERSONAL.reduce((a, c) => a + (mapeo?.[c.id] ? tot.porCargo[c.id] * (vu ? vu(mapeo[c.id]) : 0) : 0), 0)))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
