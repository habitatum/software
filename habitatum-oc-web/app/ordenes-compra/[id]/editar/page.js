'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { calcularOrdenCompra, validarAmortizacion, numeroSeguro } from '@/lib/calculosOC';
import FormularioOC from '@/lib/FormularioOC';
import NavBar from '@/components/NavBar';

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

  // Snapshot de lo que esta MISMA orden ya tenía guardado al cargarla (antes
  // de cualquier edición del usuario). Sirve para "liberar" su propia
  // amortización previa al validar contra el saldo del anticipo — si no, se
  // estaría restando dos veces lo que esta orden ya tenía amortizado.
  const [referenciaAnticipoOriginalId, setReferenciaAnticipoOriginalId] = useState('');
  const [valorAmortizacionGuardada, setValorAmortizacionGuardada] = useState(0);

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
        supabase.from('contratos').select('id, numero_contrato, estado, valor_inicial').eq('proyecto_id', proyecto.id).order('numero_contrato'),
        supabase.from('v_ordenes_compra_calculadas').select('id, folio, contrato_id, total, saldo_anticipo_por_amortizar').eq('proyecto_id', proyecto.id).eq('tipo_pago', 'ANTICIPO').neq('id', id),
        supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
      ]);
      setFolio(ocData?.folio || '');
      setOc(ocData);
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
        setEjecutadosPresupuesto(mapaEjec);
      }
    }
    cargar();
  }, [usuario, proyecto, id]);

  const calculo = useMemo(() => (oc ? calcularOrdenCompra(oc, items) : null), [oc, items]);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!oc.proveedor_id) { setError('Selecciona un proveedor.'); return; }
    if (items.length === 0 || items.every((it) => !it.descripcion)) { setError('Agrega al menos un ítem.'); return; }

    if (oc.tipo_pago === 'NORMAL' && oc.referencia_anticipo_id) {
      const anticipo = anticipos.find((a) => a.id === oc.referencia_anticipo_id);
      const resultado = validarAmortizacion({
        anticipo,
        valorAmortizacion: calculo.valor_amortizacion,
        referenciaId: oc.referencia_anticipo_id,
        referenciaOriginalId: referenciaAnticipoOriginalId,
        valorAmortizacionGuardada,
      });
      if (!resultado.ok) { setError(resultado.mensaje); return; }
    }

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
    if (errOC) { setError(errOC.message); setGuardando(false); return; }

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
    }));

    // Reemplaza los ítems: se borran los anteriores (esto también borra en
    // cascada sus imputaciones al presupuesto en items_oc_presupuesto) y se
    // insertan los actuales.
    const { error: errDelete } = await supabase.from('items_oc').delete().eq('orden_compra_id', id);
    if (errDelete) { setError(errDelete.message); setGuardando(false); return; }

    const { data: itemsInsertados, error: errItems } = await supabase.from('items_oc').insert(filasItems).select('id');
    if (errItems) { setError(errItems.message); setGuardando(false); return; }

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

    router.push(`/ordenes-compra/${id}`);
  }

  if (cargando || !usuario || !oc || !calculo) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Editar {folio}</h1>
        <p className="text-sm text-neutral-500 mb-6">{proyecto?.nombre}</p>

        <FormularioOC
          oc={oc} setOc={setOc}
          items={items} setItems={setItems}
          proveedores={proveedores} contratos={contratos} anticipos={anticipos} usuarios={usuarios}
          presupuestoCapitulos={presupuestoCapitulos}
          ejecutadosPresupuesto={ejecutadosPresupuesto}
          calculo={calculo}
          referenciaAnticipoOriginalId={referenciaAnticipoOriginalId}
          valorAmortizacionGuardada={valorAmortizacionGuardada}
          onSubmit={guardar}
          guardando={guardando}
          error={error}
          tituloBoton="Guardar cambios"
        />
      </main>
    </div>
  );
}
