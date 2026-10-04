'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { calcularOrdenCompra, validarAnticipoOC, cambioAmortizacion, numeroSeguro, mensajeErrorBD, factorEjecutado } from '@/lib/calculosOC';
import FormularioOC from '@/lib/FormularioOC';
import NavBar from '@/components/NavBar';
import BotonVolver from '@/components/BotonVolver';

// Campos propios de ordenes_compra que se pueden editar desde este formulario.
// (folio, estado, creado_por/en, modificado_por/en, proyecto_id no se tocan aquí).
const CAMPOS_EDITABLES = [
  'tipo_orden', 'contrato_id', 'fecha', 'proveedor_id', 'descripcion',
  'tipo_pago', 'referencia_anticipo_id', 'porcentaje_anticipo', 'porcentaje_amortizacion',
  'tipo_amortizacion', 'valor_amortizacion_manual',
  'responsable', 'descuento', 'tipo_impuesto', 'porcentaje_iva', 'porcentaje_administracion',
  'porcentaje_imprevistos', 'porcentaje_utilidad', 'porcentaje_retencion', 'devolucion_retenido', 'notas',
];

// Subconjunto de CAMPOS_EDITABLES que son numéricos: se sanean con
// numeroSeguro justo antes de guardar, porque un input vacío ("") pasa tal
// cual al estado y Postgres rechaza guardar texto vacío en una columna numeric.
const CAMPOS_NUMERICOS_OC = [
  'porcentaje_anticipo', 'porcentaje_amortizacion', 'valor_amortizacion_manual',
  'descuento', 'porcentaje_iva', 'porcentaje_administracion', 'porcentaje_imprevistos',
  'porcentaje_utilidad', 'porcentaje_retencion', 'devolucion_retenido',
];

export default function EditarOrdenCompra() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual(['admin', 'operativo']);
  const { proyecto } = useProyectoActual();
  const router = useRouter();
  // Para avisar al volver si hay cambios sin guardar.
  const [tocado, setTocado] = useState(false);

  const [folio, setFolio] = useState('');
  const [oc, setOc] = useState(null);
  const [items, setItems] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [anticipos, setAnticipos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [presupuestoCapitulos, setPresupuestoCapitulos] = useState([]);
  const [ejecutadosPresupuesto, setEjecutadosPresupuesto] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // 046: si la orden está en un corte de cobro cerrado, solo el admin la puede
  // corregir, con motivo; la diferencia entra como ajuste en el corte en curso.
  const [corteCerrado, setCorteCerrado] = useState(null);
  const [motivoCorreccion, setMotivoCorreccion] = useState('');
  const [autorizacion, setAutorizacion] = useState(null);
  const [autorizando, setAutorizando] = useState(false);

  // Snapshot de lo que esta MISMA orden ya tenía guardado al cargarla (antes
  // de cualquier edición del usuario). Sirve para "liberar" su propia
  // amortización previa al validar contra el saldo del anticipo — si no, se
  // estaría restando dos veces lo que esta orden ya tenía amortizado.
  const [referenciaAnticipoOriginalId, setReferenciaAnticipoOriginalId] = useState('');
  const [valorAmortizacionGuardada, setValorAmortizacionGuardada] = useState(0);
  // Copia de la orden tal como se cargó: si al editar no cambia nada de la
  // amortización, no se le exige anticipo (sin retroactividad, migración 044).
  const [ocOriginal, setOcOriginal] = useState(null);

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargar() {
      const supabase = crearClienteSupabase();
      const [{ data: ocData }, { data: itemsData }, { data: prov }, { data: cont }, { data: ant }, { data: usrs }, { data: pres }] = await Promise.all([
        // Se usa la vista calculada para traer, además de las columnas base,
        // el valor_amortizacion ya calculado y guardado de esta misma OC.
        supabase.from('v_ordenes_compra_calculadas').select('*').eq('id', id).single(),
        supabase.from('items_oc').select('*').eq('orden_compra_id', id).order('orden').order('id'),
        supabase.from('proveedores').select('id, nombre').order('nombre'),
        supabase.from('contratos').select('id, numero_contrato, estado, valor_inicial, contratista_id, concepto, proveedores(nombre)').eq('proyecto_id', proyecto.id).order('numero_contrato'),
        supabase.from('v_ordenes_compra_calculadas').select('id, folio, contrato_id, proveedor_id, estado, total, saldo_anticipo_por_amortizar').eq('proyecto_id', proyecto.id).eq('tipo_pago', 'ANTICIPO').neq('id', id),
        supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
      ]);
      setFolio(ocData?.folio || '');
      // excluir_control no está en la vista calculada: se lee de la tabla. Las
      // órdenes con excluir_control están exentas de exigir anticipo (044).
      const { data: ocBase } = await supabase.from('ordenes_compra').select('excluir_control').eq('id', id).single();
      const ocCargada = ocData ? { ...ocData, excluir_control: !!ocBase?.excluir_control } : ocData;
      setOc(ocCargada);
      setOcOriginal(ocCargada);
      const { data: enCorte } = await supabase
        .from('v_oc_corte_cerrado')
        .select('corte_numero')
        .eq('orden_compra_id', id)
        .maybeSingle();
      setCorteCerrado(enCorte || null);
      setReferenciaAnticipoOriginalId(ocData?.referencia_anticipo_id || '');
      setValorAmortizacionGuardada(Number(ocData?.valor_amortizacion || 0));
      const idsItemsData = (itemsData || []).map((it) => it.id);
      const { data: asigData } = idsItemsData.length > 0
        ? await supabase.from('items_oc_presupuesto').select('item_oc_id, presupuesto_item_id, porcentaje').in('item_oc_id', idsItemsData)
        : { data: [] };
      const asigPorItem = {};
      (asigData || []).forEach((a) => {
        if (!asigPorItem[a.item_oc_id]) asigPorItem[a.item_oc_id] = [];
        asigPorItem[a.item_oc_id].push({ presupuesto_item_id: a.presupuesto_item_id, porcentaje: Number(a.porcentaje) });
      });
      const itemsConAsignaciones = (itemsData || []).map((it) => ({ ...it, asignaciones: asigPorItem[it.id] || [] }));
      setItems(itemsConAsignaciones.length > 0 ? itemsConAsignaciones : [{ descripcion: '', unidad: '', cantidad: 1, valor_unitario: 0, sin_iva: false, asignaciones: [] }]);
      setProveedores(prov || []);
      // Se excluyen los contratos anulados del desplegable, salvo que sea el
      // contrato que esta misma OC ya tenía asignado (para no romper la
      // edición de una OC vieja vinculada a un contrato que se anuló después).
      setContratos((cont || []).filter((c) => c.estado !== 'ANULADO' || c.id === ocData?.contrato_id));
      setAnticipos(ant || []);
      setUsuarios(usrs || []);
      if (pres) {
        const { data: caps } = await supabase
          .from('presupuesto_capitulos')
          .select('id, codigo, nombre, presupuesto_items(id, codigo, descripcion, valor_parcial)')
          .eq('presupuesto_id', pres.id)
          .order('orden');
        setPresupuestoCapitulos(caps || []);
        const { data: ejec } = await supabase.from('v_presupuesto_ejecutado').select('*');
        const mapaEjec = {};
        (ejec || []).forEach((e) => { mapaEjec[e.presupuesto_item_id] = Number(e.ejecutado) || 0; });
        // El ejecutado de la base ya incluye lo que ESTA orden tenía imputado; el
        // formulario lo vuelve a sumar con sus líneas, así que se descuenta aquí
        // para no contarlo dos veces.
        if (ocData && ocData.estado !== 'ANULADA') {
          const fGuardado = factorEjecutado(ocData, calcularOrdenCompra(ocData, itemsConAsignaciones));
          itemsConAsignaciones.forEach((it) => (it.asignaciones || []).forEach((a) => {
            const v = Number(it.cantidad || 0) * Number(it.valor_unitario || 0) * fGuardado * Number(a.porcentaje || 0) / 100;
            mapaEjec[a.presupuesto_item_id] = (mapaEjec[a.presupuesto_item_id] || 0) - v;
          }));
        }
        setEjecutadosPresupuesto(mapaEjec);
      }
    }
    cargar();
  }, [usuario, proyecto, id]);

  const calculo = useMemo(() => (oc ? calcularOrdenCompra(oc, items) : null), [oc, items]);
  const exigirAnticipo = useMemo(() => (oc ? cambioAmortizacion(ocOriginal, oc) : true), [oc, ocOriginal]);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!oc.proveedor_id) { setError('Selecciona un proveedor.'); return; }
    if (items.length === 0 || items.every((it) => !it.descripcion)) { setError('Agrega al menos un ítem.'); return; }

    const validacionAnticipo = validarAnticipoOC({
      oc, anticipos, valorAmortizacion: calculo.valor_amortizacion,
      referenciaOriginalId: referenciaAnticipoOriginalId, valorAmortizacionGuardada,
      exigir: exigirAnticipo,
    });
    if (!validacionAnticipo.ok) { setError(validacionAnticipo.mensaje); return; }

    setGuardando(true);
    const supabase = crearClienteSupabase();

    const cambios = {};
    for (const campo of CAMPOS_EDITABLES) cambios[campo] = oc[campo];
    cambios.contrato_id = cambios.contrato_id || null;
    cambios.referencia_anticipo_id = cambios.referencia_anticipo_id || null;
    // Se sanea: cualquier campo numérico vacío o inválido se guarda como 0
    // en vez de mandar "" a Postgres.
    for (const campo of CAMPOS_NUMERICOS_OC) cambios[campo] = numeroSeguro(oc[campo]);

    const { error: errOC } = await supabase.from('ordenes_compra').update(cambios).eq('id', id);
    if (errOC) { setError(mensajeErrorBD(errOC.message)); setGuardando(false); return; }

    // Cada ítem puede estar imputado a varios ítems del presupuesto (por
    // porcentaje). Se valida ANTES de borrar nada.
    const itemsConDescripcion = items.filter((it) => it.descripcion);
    for (const it of itemsConDescripcion) {
      const suma = (it.asignaciones || []).reduce((acc, a) => acc + Number(a.porcentaje || 0), 0);
      if ((it.asignaciones || []).length > 1 && Math.abs(suma - 100) > 0.01) {
        setError(`El ítem "${it.descripcion}" tiene una imputación al presupuesto que no suma 100% (suma actual: ${suma.toFixed(1)}%).`);
        setGuardando(false);
        return;
      }
    }

    const filasItems = itemsConDescripcion.map((it, idx) => ({
      descripcion: it.descripcion, unidad: it.unidad,
      cantidad: numeroSeguro(it.cantidad), valor_unitario: numeroSeguro(it.valor_unitario),
      // Excluye este ítem del cálculo de IVA (ej. "Transporte sin IVA").
      sin_iva: !!it.sin_iva,
      orden: idx,
      orden_compra_id: id,
      // Conserva la imputación a capítulo (OC creadas por el bot / caja menor).
      capitulo_id: it.capitulo_id || null,
      // Conserva el vínculo con la línea del corte que la generó (045): así la
      // imputación manual no se pierde si luego se actualiza el corte.
      corte_item_id: it.corte_item_id || null,
    }));

    // Reemplaza los ítems: se borran los anteriores (esto también borra en
    // cascada sus imputaciones al presupuesto en items_oc_presupuesto) y se
    // insertan los actuales.
    const { error: errDelete } = await supabase.from('items_oc').delete().eq('orden_compra_id', id);
    if (errDelete) { setError(errDelete.message); setGuardando(false); return; }

    const { data: itemsInsertados, error: errItems } = await supabase.from('items_oc').insert(filasItems).select('id');
    if (errItems) { setError(mensajeErrorBD(errItems.message)); setGuardando(false); return; }

    const filasAsignaciones = [];
    itemsConDescripcion.forEach((it, idx) => {
      const itemOcId = itemsInsertados?.[idx]?.id;
      if (!itemOcId) return;
      (it.asignaciones || []).forEach((a) => {
        if (!a.presupuesto_item_id) return;
        filasAsignaciones.push({
          item_oc_id: itemOcId,
          presupuesto_item_id: a.presupuesto_item_id,
          porcentaje: numeroSeguro(a.porcentaje) || 100,
        });
      });
    });
    if (filasAsignaciones.length > 0) {
      const { error: errAsig } = await supabase.from('items_oc_presupuesto').insert(filasAsignaciones);
      if (errAsig) { setError(errAsig.message); setGuardando(false); return; }
    }

    // Vuelve a donde se abrió la edición (normalmente el detalle, que se recarga).
    if (window.history.length > 1) router.back();
    else router.replace(`/ordenes-compra/${id}`);
  }

  if (cargando || !usuario || !oc || !calculo) return null;

  async function autorizarCorreccion() {
    setError('');
    if (motivoCorreccion.trim().length < 5) { setError('Escriba el motivo de la corrección.'); return; }
    setAutorizando(true);
    const supabase = crearClienteSupabase();
    const { data, error: e } = await supabase.rpc('autorizar_correccion_oc', { p_oc: id, p_motivo: motivoCorreccion.trim() });
    setAutorizando(false);
    if (e) { setError(mensajeErrorBD(e.message)); return; }
    setAutorizacion(data);
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-4xl mx-auto">
        <BotonVolver respaldo={`/ordenes-compra/${id}`} hayCambios={tocado} />
        <h1 className="text-2xl font-semibold mb-1">Editar {folio}</h1>
        <p className="text-sm text-neutral-500 mb-6">{proyecto?.nombre}</p>

        {corteCerrado && !autorizacion && (
          <div className="bg-neutral-100 border border-neutral-300 rounded-lg p-4 mb-4 text-sm space-y-3">
            <p className="font-medium">🔒 Esta orden está en el corte de cobro {corteCerrado.corte_numero}, ya presentado al cliente.</p>
            {usuario.rol === 'admin' ? (
              <>
                <p className="text-neutral-600">
                  Para corregirla escriba el motivo. Tendrá 30 minutos para guardar; la diferencia entrará como ajuste
                  identificado en el corte en curso y el corte {corteCerrado.corte_numero} no cambia.
                </p>
                <textarea value={motivoCorreccion} onChange={(e) => setMotivoCorreccion(e.target.value)} rows={2}
                  placeholder="Motivo de la corrección (ej. retención acordada en el contrato)"
                  className="w-full border rounded px-3 py-2 bg-white" aria-label="Motivo de la corrección" />
                <button type="button" onClick={autorizarCorreccion} disabled={autorizando}
                  className="bg-carbon text-hueso px-4 py-2 rounded disabled:opacity-50">
                  {autorizando ? 'Autorizando...' : 'Corregir con ajuste'}
                </button>
                {error && <p className="text-red-600">{error}</p>}
              </>
            ) : (
              <p className="text-neutral-600">Solo el administrador puede corregirla.</p>
            )}
          </div>
        )}
        {corteCerrado && autorizacion && (
          <p className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-3 mb-4 text-sm">
            Corrección autorizada hasta las {new Date(autorizacion.expira_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}.
            Al guardar, la diferencia aparecerá como ajuste en el corte en curso.
          </p>
        )}
        {(!corteCerrado || autorizacion) && (
        <FormularioOC
          oc={oc} setOc={(v) => { setTocado(true); setOc(v); }}
          items={items} setItems={(v) => { setTocado(true); setItems(v); }}
          proveedores={proveedores} contratos={contratos} anticipos={anticipos} usuarios={usuarios}
          presupuestoCapitulos={presupuestoCapitulos}
          ejecutadosPresupuesto={ejecutadosPresupuesto}
          calculo={calculo}
          referenciaAnticipoOriginalId={referenciaAnticipoOriginalId}
          valorAmortizacionGuardada={valorAmortizacionGuardada}
          exigirAnticipo={exigirAnticipo}
          onSubmit={guardar}
          guardando={guardando}
          error={error}
          tituloBoton="Guardar cambios"
        />
        )}
      </main>
    </div>
  );
}
