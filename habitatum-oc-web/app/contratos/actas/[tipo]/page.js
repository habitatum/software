'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import { recalcular } from '@/lib/cortesCliente';
import { CONDICIONES_INICIO, DOCUMENTOS_ENTREGA, MODALIDAD, datosIniciales } from '@/lib/actasProyecto';
import NavBar from '@/components/NavBar';

// 081 · Acta de inicio / Acta de entrega y recibo de obra del proyecto (solo admin).
// Se llena el formulario, se guarda (actas_proyecto) y se descarga el PDF. La entrega toma del acta de inicio
// los datos generales y las fechas, de los cortes al cliente el % por capítulo y de la Caja el balance.
const CAMPO = 'border rounded px-2 py-1.5 text-sm w-full bg-white';

function Campo({ etq, children, ancho = '' }) {
  return <label className={`block space-y-1 ${ancho}`}><span className="text-xs text-neutral-600">{etq}</span>{children}</label>;
}
function Opciones({ valor, ops, onChange }) {
  return (
    <div className="flex gap-1">
      {ops.map(([k, t]) => (
        <button key={k} type="button" onClick={() => onChange(valor === k ? '' : k)}
          className={`px-2 py-1 rounded border text-xs ${valor === k ? 'bg-carbon text-hueso border-carbon' : 'bg-white text-neutral-600'}`}>{t}</button>
      ))}
    </div>
  );
}

export default function ActaProyecto() {
  const { tipo: tipoUrl } = useParams();
  const tipo = String(tipoUrl).toUpperCase() === 'ENTREGA' ? 'ENTREGA' : 'INICIO';
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [d, setD] = useState(null);
  const [guardadoEn, setGuardadoEn] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!esAdmin || !proyecto?.id) return;
    (async () => {
      const s = crearClienteSupabase();
      const { data: pr } = await s.from('proyectos').select('*').eq('id', proyecto.id).single();
      const { data: actas } = await s.from('actas_proyecto').select('*').eq('proyecto_id', proyecto.id);
      const propia = (actas || []).find((a) => a.tipo === tipo);
      const inicio = (actas || []).find((a) => a.tipo === 'INICIO')?.datos;
      let cobro = null; let capitulos = []; let avance = {};
      if (pr.modelo_contratacion === 'TODO_COSTO') {
        const { data: cp } = await s.rpc('caja_proyecto', { p_proyecto: proyecto.id });
        cobro = cp?.cobro || null;
      }
      if (tipo === 'ENTREGA') {
        const { data: pres } = await s.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle();
        if (pres) {
          const { data: caps } = await s.from('presupuesto_capitulos').select('id, codigo, nombre, orden').eq('presupuesto_id', pres.id).order('orden');
          capitulos = caps || [];
        }
        // % ejecutado por capítulo: del último corte al cliente (todo costo).
        const { data: lista } = await s.rpc('cortes_cliente_lista', { p_proyecto: proyecto.id });
        const ult = (lista || []).filter((c) => c.estado !== 'ANULADO').slice(-1)[0];
        if (ult) {
          const { data: det } = await s.rpc('corte_cliente_detalle', { p_corte: ult.id });
          if (det) {
            const calc = recalcular(det);
            calc.capitulos.filter((c) => c.grupo === 'CONTRATO').forEach((c) => { avance[c.codigo] = Math.round(Number(c.avance || 0) * 10) / 10; });
          }
        }
      }
      const base = datosIniciales({ tipo, proyecto: pr, inicio, capitulos, cobro, avance });
      setD(propia ? { ...base, ...propia.datos } : base);
      setGuardadoEn(propia?.actualizado_en || null);
    })();
  }, [esAdmin, proyecto?.id, tipo]);

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const titulo = tipo === 'INICIO' ? 'Acta de inicio de obra' : 'Acta de entrega y recibo de obra';

  async function guardar() {
    setTrabajando(true); setError(''); setAviso('');
    const { error: e } = await crearClienteSupabase().from('actas_proyecto')
      .upsert({ proyecto_id: proyecto.id, tipo, datos: d, actualizado_en: new Date().toISOString() });
    setTrabajando(false);
    if (e) { setError(e.message); return false; }
    setGuardadoEn(new Date().toISOString()); setAviso('Acta guardada.');
    return true;
  }
  async function pdf(borrador) {
    if (!borrador && !(await guardar())) return;
    const { data: { session } } = await crearClienteSupabase().auth.getSession();
    await compartirOAbrirArchivo('/api/actas/pdf', `${tipo === 'INICIO' ? 'Acta de inicio' : 'Acta de entrega'} - ${proyecto.nombre}.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ tipo, proyectoId: proyecto.id, datos: d, borrador }),
    });
  }

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;
  if (!esAdmin) {
    return (<div><NavBar usuario={usuario} proyecto={proyecto} /><main className="p-8 text-center text-neutral-500">Esta sección es solo para administradores.</main></div>);
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5">
        <div>
          <a href="/contratos" className="text-sm text-neutral-500 hover:text-carbon">← Volver a Contratos</a>
          <h1 className="text-2xl font-semibold mt-2">{titulo}</h1>
          <p className="text-sm text-neutral-500">{proyecto.nombre} · {MODALIDAD[proyecto.modelo_contratacion] || ''}
            {guardadoEn ? ` · guardada el ${new Date(guardadoEn).toLocaleString('es-CO')}` : ' · sin guardar'}</p>
        </div>
        {error && <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">{error}</p>}
        {aviso && <p className="bg-green-50 border border-green-200 text-green-800 text-sm rounded p-3">{aviso}</p>}
        {!d ? <p className="text-sm text-neutral-500">Cargando…</p> : (
          <>
            <section className="bg-white border rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-sm">1. Datos generales</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                {tipo === 'INICIO' && <Campo etq="Acta No."><input value={d.numero} onChange={(e) => set('numero', e.target.value)} className={CAMPO} /></Campo>}
                <Campo etq="Fecha del acta"><input type="date" value={d.fecha_acta} onChange={(e) => set('fecha_acta', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="Ciudad"><input value={d.ciudad} onChange={(e) => set('ciudad', e.target.value)} className={CAMPO} /></Campo>
              </div>
              <Campo etq="Dirección de la obra"><input value={d.direccion} onChange={(e) => set('direccion', e.target.value)} className={CAMPO} /></Campo>
              <div className="grid sm:grid-cols-3 gap-3">
                <Campo etq="Contratante (cliente)"><input value={d.cliente} onChange={(e) => set('cliente', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="NIT / C.C. del contratante"><input value={d.nit_cliente} onChange={(e) => set('nit_cliente', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="Representante del contratante"><input value={d.rep_cliente} onChange={(e) => set('rep_cliente', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="Contratista"><input value={d.contratista} onChange={(e) => set('contratista', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="NIT del contratista"><input value={d.nit_contratista} onChange={(e) => set('nit_contratista', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="Representante del contratista"><input value={d.rep_contratista} onChange={(e) => set('rep_contratista', e.target.value)} className={CAMPO} /></Campo>
                <Campo etq="Contrato No. / fecha"><input value={d.contrato_no} onChange={(e) => set('contrato_no', e.target.value)} placeholder="06-2026 del 15/10/2026" className={CAMPO} /></Campo>
                <Campo etq="Valor del contrato"><input type="number" value={d.valor} onChange={(e) => set('valor', e.target.value)} className={`${CAMPO} text-right`} /></Campo>
                <Campo etq="Director de obra / residente"><input value={d.director} onChange={(e) => set('director', e.target.value)} className={CAMPO} /></Campo>
              </div>
              <Campo etq="Objeto del contrato"><textarea rows={2} value={d.objeto} onChange={(e) => set('objeto', e.target.value)} className={CAMPO} /></Campo>
            </section>

            {tipo === 'INICIO' ? (
              <>
                <section className="bg-white border rounded-lg p-5 space-y-3">
                  <h2 className="font-semibold text-sm">2. Plazo y fechas</h2>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Campo etq="Plazo de ejecución"><input value={d.plazo} onChange={(e) => set('plazo', e.target.value)} placeholder="90 días calendario" className={CAMPO} /></Campo>
                    <Campo etq="Fecha de inicio"><input type="date" value={d.inicio} onChange={(e) => set('inicio', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etq="Fecha prevista de terminación"><input type="date" value={d.fin} onChange={(e) => set('fin', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etq="Horario de obra"><input value={d.horario} onChange={(e) => set('horario', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etq="Anticipo recibido (valor)"><input type="number" value={d.anticipo_valor} onChange={(e) => set('anticipo_valor', e.target.value)} className={`${CAMPO} text-right`} /></Campo>
                    <Campo etq="Fecha del anticipo"><input type="date" value={d.anticipo_fecha} onChange={(e) => set('anticipo_fecha', e.target.value)} className={CAMPO} /></Campo>
                  </div>
                </section>
                <section className="bg-white border rounded-lg p-5 space-y-2">
                  <h2 className="font-semibold text-sm">3. Condiciones para el inicio</h2>
                  {CONDICIONES_INICIO.map((c) => (
                    <div key={c.k} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-neutral-100 py-1.5 text-sm">
                      <span>{c.t}</span>
                      <Opciones valor={d.condiciones?.[c.k]} ops={c.na ? [['SI', 'Sí'], ['NO', 'No'], ['NA', 'No aplica']] : [['SI', 'Sí'], ['NO', 'No']]}
                        onChange={(v) => set('condiciones', { ...d.condiciones, [c.k]: v })} />
                    </div>
                  ))}
                  <p className="text-[11px] text-neutral-500">Lo que se deje sin marcar sale en blanco en el PDF para marcarlo a mano.</p>
                </section>
              </>
            ) : (
              <>
                <section className="bg-white border rounded-lg p-5 space-y-3">
                  <h2 className="font-semibold text-sm">2. Plazo</h2>
                  <div className="grid sm:grid-cols-4 gap-3">
                    <Campo etq="Fecha de inicio"><input type="date" value={d.inicio} onChange={(e) => set('inicio', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etq="Terminación prevista"><input type="date" value={d.fin_prevista} onChange={(e) => set('fin_prevista', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etq="Terminación real"><input type="date" value={d.fin_real} onChange={(e) => set('fin_real', e.target.value)} className={CAMPO} /></Campo>
                    <Campo etq="Prórrogas / suspensiones"><input value={d.prorrogas} onChange={(e) => set('prorrogas', e.target.value)} placeholder="Ninguna" className={CAMPO} /></Campo>
                  </div>
                </section>
                <section className="bg-white border rounded-lg p-5 space-y-2">
                  <h2 className="font-semibold text-sm">3. Obra entregada</h2>
                  {(d.capitulos || []).length === 0 && <p className="text-sm text-neutral-500">El proyecto no tiene presupuesto cargado.</p>}
                  {(d.capitulos || []).map((c, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 border-b border-neutral-100 py-1.5 text-sm">
                      <span className="flex-1">{c.codigo} · {c.nombre}</span>
                      <span className="flex items-center gap-1"><input type="number" value={c.pct} onChange={(e) => set('capitulos', d.capitulos.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className="border rounded px-2 py-1 w-20 text-right text-sm" />%</span>
                      <Opciones valor={c.estado} ops={[['CONFORME', 'Conforme'], ['PENDIENTES', 'Con pendientes']]}
                        onChange={(v) => set('capitulos', d.capitulos.map((x, j) => (j === i ? { ...x, estado: v } : x)))} />
                    </div>
                  ))}
                </section>
                <section className="bg-white border rounded-lg p-5 space-y-3">
                  <h2 className="font-semibold text-sm">4. Balance económico</h2>
                  <div className="grid sm:grid-cols-4 gap-3">
                    <Campo etq="Valor del contrato"><input type="number" value={d.valor} onChange={(e) => set('valor', e.target.value)} className={`${CAMPO} text-right`} /></Campo>
                    <Campo etq="(+) Adicionales"><input type="number" value={d.adicionales} onChange={(e) => set('adicionales', e.target.value)} className={`${CAMPO} text-right`} /></Campo>
                    <Campo etq="(-) Deductivos"><input type="number" value={d.deductivos} onChange={(e) => set('deductivos', e.target.value)} className={`${CAMPO} text-right`} /></Campo>
                    <Campo etq="(-) Pagos recibidos"><input type="number" value={d.pagos} onChange={(e) => set('pagos', e.target.value)} className={`${CAMPO} text-right`} /></Campo>
                  </div>
                  <p className="text-[11px] text-neutral-500">En todo costo vienen de la Caja (cobro del contrato y adicionales). Se pueden ajustar antes de imprimir.</p>
                </section>
                <section className="bg-white border rounded-lg p-5 space-y-2">
                  <h2 className="font-semibold text-sm">5. Pendientes por corregir</h2>
                  {(d.pendientes || []).map((x, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_160px_150px_auto] gap-2">
                      <input value={x.descripcion} onChange={(e) => set('pendientes', d.pendientes.map((y, j) => (j === i ? { ...y, descripcion: e.target.value } : y)))} placeholder="Descripción" className={CAMPO} />
                      <input value={x.responsable} onChange={(e) => set('pendientes', d.pendientes.map((y, j) => (j === i ? { ...y, responsable: e.target.value } : y)))} placeholder="Responsable" className={CAMPO} />
                      <input type="date" value={x.fecha} onChange={(e) => set('pendientes', d.pendientes.map((y, j) => (j === i ? { ...y, fecha: e.target.value } : y)))} className={CAMPO} />
                      <button type="button" onClick={() => set('pendientes', d.pendientes.filter((_, j) => j !== i))} className="text-xs text-red-600 underline">quitar</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => set('pendientes', [...(d.pendientes || []), { descripcion: '', responsable: '', fecha: '' }])} className="text-xs border border-dorado text-[#6b4a22] rounded px-3 py-1.5">+ Agregar pendiente</button>
                </section>
                <section className="bg-white border rounded-lg p-5 space-y-2">
                  <h2 className="font-semibold text-sm">6. Documentos que se entregan</h2>
                  {DOCUMENTOS_ENTREGA.map((c) => (
                    <div key={c.k} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-neutral-100 py-1.5 text-sm">
                      <span>{c.t}</span>
                      <Opciones valor={d.documentos?.[c.k]} ops={[['SI', 'Sí'], ['NA', 'No aplica']]} onChange={(v) => set('documentos', { ...d.documentos, [c.k]: v })} />
                    </div>
                  ))}
                  <div className="pt-2 max-w-xs"><Campo etq="Garantía de acabados (meses)"><input type="number" value={d.meses_garantia} onChange={(e) => set('meses_garantia', e.target.value)} className={CAMPO} /></Campo></div>
                </section>
              </>
            )}
            <section className="bg-white border rounded-lg p-5 space-y-2">
              <h2 className="font-semibold text-sm">Observaciones</h2>
              <textarea rows={3} value={d.observaciones} onChange={(e) => set('observaciones', e.target.value)} className={CAMPO} />
            </section>
            <div className="flex flex-wrap gap-2 sticky bottom-0 bg-[#f7f5f1]/95 py-3">
              <button type="button" disabled={trabajando} onClick={guardar} className="border border-carbon px-4 py-2 rounded text-sm disabled:opacity-50">Guardar</button>
              <button type="button" disabled={trabajando} onClick={() => pdf(true)} className="border px-4 py-2 rounded text-sm bg-white">Vista previa (borrador)</button>
              <button type="button" disabled={trabajando} onClick={() => pdf(false)} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">Guardar y descargar PDF</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
