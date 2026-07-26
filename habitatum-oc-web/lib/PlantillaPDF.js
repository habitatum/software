import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { EncabezadoPDF, COLOR_DORADO } from './EncabezadoPDF';
import CuadroAcumuladosPDF from './CuadroAcumuladosPDF';

const COLORES_RECUADRO = {
  amber: { bg: '#fffbeb', borde: '#d97706', texto: '#78350f' },
  red: { bg: '#fef2f2', borde: '#dc2626', texto: '#7f1d1d' },
  green: { bg: '#f0fdf4', borde: '#16a34a', texto: '#14532d' },
};

const estilos = StyleSheet.create({
  pagina: { padding: 30, fontSize: 10, fontFamily: 'Helvetica' },
  fila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  seccion: { marginBottom: 12 },
  tituloSeccion: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, borderBottom: 1, borderColor: COLOR_DORADO, paddingBottom: 2 },
  tablaEncabezado: { flexDirection: 'row', backgroundColor: '#efece6', padding: 4, fontWeight: 'bold' },
  tablaFila: { flexDirection: 'row', padding: 4, borderBottom: 0.5, borderColor: '#cdc5ba' },
  colDesc: { flex: 4 },
  colUnidad: { flex: 1, textAlign: 'center' },
  colCant: { flex: 1, textAlign: 'right' },
  colPrecio: { flex: 1.5, textAlign: 'right' },
  colVal: { flex: 1.5, textAlign: 'right' },
  colPct: { flex: 1, textAlign: 'right' },
  cuadroOrden: { backgroundColor: '#2e2e2e', color: '#efece6', borderRadius: 4, padding: 12, marginBottom: 12 },
  cuadroTitulo: { color: '#cdc5ba', fontWeight: 'bold', marginBottom: 6, fontSize: 11 },
  filaCuadro: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  filaSutil: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2, color: '#cdc5ba', fontSize: 8 },
  filaDestacada: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTop: 0.5, borderColor: '#efece6', fontWeight: 'bold' },
  filaGrande: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTop: 0.5, borderColor: '#efece6', fontWeight: 'bold', fontSize: 13, color: COLOR_DORADO },
  recuadro: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 4, borderWidth: 1, padding: 10, marginBottom: 12 },
  recuadroTitulo: { fontSize: 10, fontWeight: 'bold' },
  recuadroValor: { fontSize: 15, fontWeight: 'bold' },
});

function FilaCuadro({ label, valor, destacado, grande, sutil, negativo }) {
  const estilo = grande ? estilos.filaGrande : destacado ? estilos.filaDestacada : sutil ? estilos.filaSutil : estilos.filaCuadro;
  return (
    <View style={estilo}>
      <Text>{label}</Text>
      <Text>{negativo ? '-' : ''}{formatoPesos(valor)}</Text>
    </View>
  );
}

export default function PlantillaOrdenCompraPDF({ oc, items, acumulados, nombreObra, mostrarMarcaHabitatum, nombreEmisor }) {
  let recuadro = { color: 'green', titulo: 'PAGADA EN SU TOTALIDAD', valor: 0 };
  if ((oc.pagado || 0) <= 0) {
    recuadro = { color: 'amber', titulo: 'VALOR A PAGAR AHORA', valor: oc.neto_a_pagar };
  } else if ((oc.saldo || 0) > 0) {
    recuadro = { color: 'red', titulo: 'SALDO PENDIENTE POR TRANSFERIR', valor: oc.saldo };
  }
  const colores = COLORES_RECUADRO[recuadro.color];

  return (
    <Document>
      <Page size="A4" style={estilos.pagina}>
        <EncabezadoPDF
          tituloDocumento={`Orden de Compra ${oc.folio}`}
          nombreObra={nombreObra}
          mostrarMarcaHabitatum={mostrarMarcaHabitatum}
          nombreEmisor={nombreEmisor}
        />

        <View style={[estilos.recuadro, { backgroundColor: colores.bg, borderColor: colores.borde }]}>
          <Text style={[estilos.recuadroTitulo, { color: colores.texto }]}>{recuadro.titulo}</Text>
          <Text style={[estilos.recuadroValor, { color: colores.texto }]}>{formatoPesos(recuadro.valor)}</Text>
        </View>

        <View style={estilos.seccion}>
          <View style={estilos.fila}><Text>Proveedor:</Text><Text>{oc.proveedores?.nombre}</Text></View>
          <View style={estilos.fila}><Text>NIT:</Text><Text>{oc.proveedores?.nit}</Text></View>
          <View style={estilos.fila}><Text>Contrato:</Text><Text>{oc.contratos?.numero_contrato ?? '—'}</Text></View>
          <View style={estilos.fila}><Text>Fecha:</Text><Text>{oc.fecha}</Text></View>
          <View style={estilos.fila}><Text>Responsable:</Text><Text>{oc.responsable}</Text></View>
          {oc.descripcion && <View style={estilos.fila}><Text>Descripción:</Text><Text>{oc.descripcion}</Text></View>}
        </View>

        <View style={estilos.seccion}>
          <Text style={estilos.tituloSeccion}>Ítems</Text>
          <View style={estilos.tablaEncabezado}>
            <Text style={estilos.colDesc}>Descripción</Text>
            <Text style={estilos.colUnidad}>Unidad</Text>
            <Text style={estilos.colCant}>Cant.</Text>
            <Text style={estilos.colPrecio}>Precio unit.</Text>
            <Text style={estilos.colVal}>Subtotal</Text>
            <Text style={estilos.colPct}>% Orden</Text>
          </View>
          {items.map((it, i) => {
            const subtotalItem = it.cantidad * it.valor_unitario;
            const porcentaje = oc.total > 0 ? (subtotalItem / oc.total) * 100 : 0;
            return (
              <View key={i} style={estilos.tablaFila}>
                <Text style={estilos.colDesc}>{it.descripcion}</Text>
                <Text style={estilos.colUnidad}>{it.unidad || '—'}</Text>
                <Text style={estilos.colCant}>{it.cantidad}</Text>
                <Text style={estilos.colPrecio}>{formatoPesos(it.valor_unitario)}</Text>
                <Text style={estilos.colVal}>{formatoPesos(subtotalItem)}</Text>
                <Text style={estilos.colPct}>{porcentaje.toFixed(1)}%</Text>
              </View>
            );
          })}
        </View>

        <View style={estilos.cuadroOrden}>
          <Text style={estilos.cuadroTitulo}>Esta Orden</Text>
          <FilaCuadro label="Subtotal" valor={oc.subtotal} />
          {Number(oc.descuento) > 0 && <FilaCuadro label="- Descuento" valor={oc.descuento} negativo />}
          {oc.tipo_impuesto === 'CON_IVA' && (
            <FilaCuadro label={`+ IVA (${oc.porcentaje_iva || 0}%)`} valor={oc.valor_iva} />
          )}
          {oc.tipo_impuesto === 'CON_AIU' && (
            <>
              <FilaCuadro label={`+ AIU (${oc.porcentaje_aiu || 0}%)`} valor={oc.valor_aiu} />
              {Number(oc.porcentaje_administracion) > 0 && (
                <FilaCuadro label={`   · Administración (${oc.porcentaje_administracion}%)`} valor={oc.valor_administracion} sutil />
              )}
              {Number(oc.porcentaje_imprevistos) > 0 && (
                <FilaCuadro label={`   · Imprevistos (${oc.porcentaje_imprevistos}%)`} valor={oc.valor_imprevistos} sutil />
              )}
              {Number(oc.porcentaje_utilidad) > 0 && (
                <FilaCuadro label={`   · Utilidad (${oc.porcentaje_utilidad}%)`} valor={oc.valor_utilidad} sutil />
              )}
              {Number(oc.porcentaje_utilidad) > 0 && (
                <FilaCuadro label={`+ IVA sobre la Utilidad (${oc.porcentaje_iva || 0}%)`} valor={oc.valor_iva} />
              )}
            </>
          )}
          <FilaCuadro label="TOTAL" valor={oc.total} destacado />
          {Number(oc.porcentaje_retencion) > 0 && (
            <FilaCuadro label={`- Retenido (${oc.porcentaje_retencion}%)`} valor={oc.valor_retenido} negativo />
          )}
          {Number(oc.porcentaje_amortizacion) > 0 && (
            <FilaCuadro label={`- Amortización anticipo (${oc.porcentaje_amortizacion}%)`} valor={oc.valor_amortizacion} negativo />
          )}
          {Number(oc.devolucion_retenido) > 0 && (
            <FilaCuadro label="+ Devolución retenido" valor={oc.devolucion_retenido} />
          )}
          <FilaCuadro label="A PAGAR" valor={oc.neto_a_pagar} grande />
          {oc.tipo_pago === 'ANTICIPO' && (
            <FilaCuadro label="Saldo del anticipo por amortizar" valor={oc.saldo_anticipo_por_amortizar} destacado />
          )}
        </View>

        {oc.contrato_id && (
          <CuadroAcumuladosPDF acumulados={acumulados} numeroContrato={oc.contratos?.numero_contrato} />
        )}

        {oc.notas && (
          <View style={estilos.seccion}>
            <Text style={estilos.tituloSeccion}>Notas</Text>
            <Text>{oc.notas}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
