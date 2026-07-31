'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { calcularOrdenCompra } from '@/lib/calculosOC';
import FormularioOC from '@/lib/FormularioOC';
import NavBar from '@/components/NavBar';

const OC_VACIA = {
  tipo_orden: 'COMPRA', contrato_id: '', fecha: new Date().toISOString().slice(0, 10),
  proveedor_id: '', descripcion: '', tipo_pago: 'NORMAL',
  referencia_anticipo_id: '', porcentaje_anticipo: 0, porcentaje_amortizacion: 0,
  responsable: '', descuento: 0, tipo_impuesto: 'SIN_IVA',
  porcentaje_iva: 19, porcentaje_administracion: 0, porcentaje_imprevistos: 0,
  porcentaje_utilidad: 0, porcentaje_retencion: 0, devolucion_retenido: 0, notas: '',
};

export default function NuevaOrdenCompra() {
  const { usuario, cargando } = useUsuarioActual(['admin', 'operativo']);
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const router = useRouter();

  const [oc, setOc] = useState(OC_VACIA);
  const [items, setItems] = useState([{ descripcion: '', unidad: '', cantidad: 1, valor_unitario: 0 }]);
  const [proveedores, setProveedores] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [anticipos, setAnticipos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [presupuestoCapitulos, setPresupuestoCapitulos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargarCatalogos() {
      const supabase = crearClienteSupabase();
      // Los Proveedores son globales: se muestran todos, sin filtrar por proyecto.
      const [{ data: prov }, { data: cont }, { data: ant }, { data: usrs }, { data: pres }] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').order('nombre'),
        supabase.from('contratos').select('id, numero_contrato, estado').eq('proyecto_id', proyecto.id).order('numero_contrato'),
        supabase.from('ordenes_compra').select('id, folio, contrato_id').eq('proyecto_id', proyecto.id).eq('tipo_pago', 'ANTICIPO'),
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
          .select('id, codigo, nombre, presupuesto_items(id, codigo, descripcion)')
          .eq('presupuesto_id', pres.id)
          .order('orden');
        setPresupuestoCapitulos(caps || []);
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

    setGuardando(true);
    const supabase = crearClienteSupabase();

    const { data: nuevaOC, error: errOC } = await supabase
      .from('ordenes_compra')
      .insert({
        ...oc,
        proyecto_id: proyecto.id,
        contrato_id: oc.contrato_id || null,
        referencia_anticipo_id: oc.referencia_anticipo_id || null,
        creado_por: usuario.id,
      })
      .select()
      .single();

    if (errOC) { setError(errOC.message); setGuardando(false); return; }

    const filasItems = items
      .filter((it) => it.descripcion)
      .map((it, idx) => ({ ...it, orden: idx, orden_compra_id: nuevaOC.id }));

    const { error: errItems } = await supabase.from('items_oc').insert(filasItems);
    if (errItems) { setError(errItems.message); setGuardando(false); return; }

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
          calculo={calculo}
          onSubmit={guardar}
          guardando={guardando}
          error={error}
          tituloBoton="Guardar Orden de Compra"
        />
      </main>
    </div>
  );
}
