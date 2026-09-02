'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { calcularOrdenCompra, validarAmortizacion, numeroSeguro } from '@/lib/calculosOC';
import FormularioOC from '@/lib/FormularioOC';
import NavBar from '@/components/NavBar';

// Campos numéricos de ordenes_compra: se sanean con numeroSeguro justo antes
// de guardar, porque un input vacío ("") pasa tal cual al estado y Postgres
// rechaza guardar texto vacío en una columna numeric.
const CAMPOS_NUMERICOS_OC = [
  'porcentaje_anticipo', 'porcentaje_amortizacion', 'valor_amortizacion_manual',
  'descuento', 'porcentaje_iva', 'porcentaje_administracion', 'porcentaje_imprevistos',
  'porcentaje_utilidad', 'porcentaje_retencion', 'devolucion_retenido',
];

const OC_VACIA = {
  tipo_orden: 'COMPRA', contrato_id: '', fecha: new Date().toISOString().slice(0, 10),
  proveedor_id: '', descripcion: '', tipo_pago: 'NORMAL',
  referencia_anticipo_id: '', porcentaje_anticipo: 0, porcentaje_amortizacion: 0,
  tipo_amortizacion: 'PORCENTAJE', valor_amortizacion_manual: 0,
  responsable: '', descuento: 0, tipo_impuesto: 'SIN_IVA',
  porcentaje_iva: 19, porcentaje_administracion: 0, porcentaje_imprevistos: 0,
  porcentaje_utilidad: 0, porcentaje_retencion: 0, devolucion_retenido: 0, notas: '',
};

export default function NuevaOrdenCompra() {
  const { usuario, cargando } = useUsuarioActual(['admin', 'operativo']);
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const router = useRouter();

  const [oc, setOc] = useState(OC_VACIA);
  const [items, setItems] = useState([{ descripcion: '', unidad: '', cantidad: 1, valor_unitario: 0, sin_iva: false }]);
  const [proveedores, setProveedores] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [anticipos, setAnticipos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [presupuestoCapitulos, setPresupuestoCapitulos] = useState([]);
  const [ejecutadosPresupuesto, setEjecutadosPresupuesto] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargarCatalogos() {
      const supabase = crearClienteSupabase();
      // Los Proveedores son globales: se muestran todos, sin filtrar por proyecto.
      const [{ data: prov }, { data: cont }, { data: ant }, { data: usrs }, { data: pres }] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').order('nombre'),
        supabase.from('contratos').select('id, numero_contrato, estado, valor_inicial').eq('proyecto_id', proyecto.id).order('numero_contrato'),
        // Se usa la vista calculada para traer también el saldo pendiente por
        // amortizar de cada anticipo (necesario para avisar/objetar si una OC
        // se pasa del saldo disponible).
        supabase.from('v_ordenes_compra_calculadas').select('id, folio, contrato_id, total, saldo_anticipo_por_amortizar').eq('proyecto_id', proyecto.id).eq('tipo_pago', 'ANTICIPO'),
        supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
      ]);
      setProveedores(prov || []);
      // Una Orden de Compra nueva nunca debe poder vincularse a un contrato
      // anulado: se excluye por completo de este desplegable (a diferencia
      // de "editar", aquí no hay una selección previa que preservar).
      setContratos((cont || []).filter((c) => c.estado !== 'ANULADO'));
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
    cargarCatalogos();
  }, [usuario, proyecto]);

  const calculo = useMemo(() => calcularOrdenCompra(oc, items), [oc, items]);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!oc.proveedor_id) { setError('Selecciona un proveedor.'); return; }
    if (items.length === 0 || items.every((it) => !it.descripcion)) { setError('Agrega al menos un ítem.'); return; }

    // Es una OC nueva: no tenía ninguna amortización guardada antes, así que
    // no hay nada que "liberar" del saldo del anticipo referenciado.
    if (oc.tipo_pago === 'NORMAL' && oc.referencia_anticipo_id) {
      const anticipo = anticipos.find((a) => a.id === oc.referencia_anticipo_id);
      const resultado = validarAmortizacion({
        anticipo,
        valorAmortizacion: calculo.valor_amortizacion,
        referenciaId: oc.referencia_anticipo_id,
        referenciaOriginalId: '',
        valorAmortizacionGuardada: 0,
      });
      if (!resultado.ok) { setError(resultado.mensaje); return; }
    }

    setGuardando(true);
    const supabase = crearClienteSupabase();

    // Se sanea la copia a insertar: cualquier campo numérico vacío o
    // inválido se guarda como 0 en vez de mandar "" a Postgres.
    const ocSaneada = { ...oc };
    for (const campo of CAMPOS_NUMERICOS_OC) ocSaneada[campo] = numeroSeguro(oc[campo]);

    const { data: nuevaOC, error: errOC } = await supabase
      .from('ordenes_compra')
      .insert({
        ...ocSaneada,
        proyecto_id: proyecto.id,
        contrato_id: oc.contrato_id || null,
        referencia_anticipo_id: oc.referencia_anticipo_id || null,
        creado_por: usuario.id,
      })
      .select()
      .single();

    if (errOC) { setError(errOC.message); setGuardando(false); return; }

    // Cada ítem puede estar imputado a varios ítems del presupuesto (por
    // porcentaje); "asignaciones" no es una columna de items_oc, así que se
    // excluye del insert y se guarda aparte en items_oc_presupuesto.
    const itemsConDescripcion = items.filter((it) => it.descripcion);
    for (const it of itemsConDescripcion) {
      const suma = (it.asignaciones || []).reduce((acc, a) => acc + Number(a.porcentaje || 0), 0);
      if ((it.asignaciones || []).length > 1 && Math.abs(suma - 100) > 0.01) {
        setError(`El ítem "${it.descripcion}" tiene una imputación al presupuesto que no suma 100% (suma actual: ${suma.toFixed(1)}%).`);
        setGuardando(false);
        return;
      }
    }

    const filasItems = itemsConDescripcion.map((it, idx) => {
      const { asignaciones, ...resto } = it;
      return {
        ...resto,
        cantidad: numeroSeguro(it.cantidad),
        valor_unitario: numeroSeguro(it.valor_unitario),
        sin_iva: !!it.sin_iva,
        orden: idx,
        orden_compra_id: nuevaOC.id,
      };
    });

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

    router.push(`/ordenes-compra/${nuevaOC.id}`);
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Nueva Orden de Compra</h1>
        <p className="text-sm text-neutral-500 mb-6">{proyecto.nombre}</p>

        <FormularioOC
          oc={oc} setOc={setOc}
          items={items} setItems={setItems}
          proveedores={proveedores} contratos={contratos} anticipos={anticipos} usuarios={usuarios}
          presupuestoCapitulos={presupuestoCapitulos}
          ejecutadosPresupuesto={ejecutadosPresupuesto}
          calculo={calculo}
          referenciaAnticipoOriginalId=""
          valorAmortizacionGuardada={0}
          onSubmit={guardar}
          guardando={guardando}
          error={error}
          tituloBoton="Guardar Orden de Compra"
        />
      </main>
    </div>
  );
}
