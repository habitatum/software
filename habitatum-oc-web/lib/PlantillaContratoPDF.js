import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { EncabezadoPDF, COLOR_DORADO } from './EncabezadoPDF';
import { TITULOS_TIPO_CONTRATO, clausulasDelContrato } from './plantillasContrato';

const NEGRO = '#000000';

const estilos = StyleSheet.create({
  pagina: { padding: 30, fontSize: 9.5, fontFamily: 'Helvetica', color: NEGRO },
  tituloDoc: { fontSize: 13, fontWeight: 'bold', textAlign: 'center', marginBottom: 12, color: NEGRO },
  tituloSeccion: { fontSize: 11, fontWeight: 'bold', marginTop: 12, marginBottom: 4, color: NEGRO },
  tablaInfo: { borderWidth: 0.5, borderColor: COLOR_DORADO, marginBottom: 4 },
  filaInfo: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLOR_DORADO },
  filaInfoUltima: { flexDirection: 'row' },
  celdaEtiqueta: { width: '32%', backgroundColor: '#F5EFE6', padding: 5, fontWeight: 'bold', fontSize: 9 },
  celdaValor: { width: '68%', padding: 5, fontSize: 9 },
  notaSinPolizas: { fontSize: 9, fontStyle: 'italic', color: '#777777', marginTop: 4 },
  clausulaTitulo: { fontSize: 10, fontWeight: 'bold', marginTop: 8, marginBottom: 2 },
  clausulaTexto: { fontSize: 9, marginBottom: 2, textAlign: 'justify' },
  tablaItems: { marginTop: 4 },
  itemsEncabezado: { flexDirection: 'row', backgroundColor: '#F5EFE6', padding: 4, fontWeight: 'bold', fontSize: 8.5, borderBottomWidth: 0.5, borderBottomColor: COLOR_DORADO },
  itemsFila: { flexDirection: 'row', padding: 4, fontSize: 8.5, borderBottomWidth: 0.5, borderBottomColor: '#e5e0d8' },
  itemsFilaTotal: { flexDirection: 'row', padding: 4, fontSize: 9, fontWeight: 'bold', backgroundColor: '#F5EFE6' },
  colDescripcion: { flex: 3 }, colUnidad: { flex: 1 }, colCantidad: { flex: 1, textAlign: 'right' },
  colValorUnitario: { flex: 1.3, textAlign: 'right' }, colTotal: { flex: 1.3, textAlign: 'right' },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  lineaFirma: { width: '45%', textAlign: 'center' },
  rayaFirma: { borderTopWidth: 0.5, borderTopColor: NEGRO, marginBottom: 4, paddingTop: 4 },
});

function fechaFormateada(f) {
  if (!f) return '-';
  const soloFecha = String(f).slice(0, 10);
  const partes = soloFecha.split('-');
  if (partes.length !== 3) return String(f);
  return `${Number(partes[2])}/${Number(partes[1])}/${partes[0]}`;
}

function numeroContrato(c) {
  return c.codigo_proyecto ? `${c.codigo_proyecto}-${c.anio}-${String(c.consecutivo).padStart(2, '0')}` : (c.numero_contrato || '');
}

function TablaInfo({ filas }) {
  return (
    <View style={estilos.tablaInfo}>
      {filas.map(([etiqueta, valor], i) => (
        <View key={etiqueta} style={i === filas.length - 1 ? estilos.filaInfoUltima : estilos.filaInfo}>
          <Text style={estilos.celdaEtiqueta}>{etiqueta}</Text>
          <Text style={estilos.celdaValor}>{valor === undefined || valor === null || valor === '' ? '-' : String(valor)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PlantillaContratoPDF({ contrato, proyecto, proveedor, mostrarMarcaHabitatum, nombreEmisor }) {
  const numero = numeroContrato(contrato);
  const tituloDoc = (TITULOS_TIPO_CONTRATO[contrato.tipo_contrato] || TITULOS_TIPO_CONTRATO.SUMINISTRO_E_INSTALACION) + numero;
  const clausulas = clausulasDelContrato(contrato);
  const items = Array.isArray(contrato.items_excel) ? contrato.items_excel : [];
  const totalItems = items.reduce((acc, it) => acc + (Number(it.total) || 0), 0);

  const polizas = [];
  if (contrato.incluye_anticipo) polizas.push(['Anticipo', `${Number(contrato.pct_anticipo) || 0}% del valor del contrato, amortizable contra las Órdenes de Compra que se expidan durante la ejecución.`]);
  if (contrato.incluye_poliza_cumplimiento) polizas.push(['Póliza de cumplimiento', 'Vigencia igual al plazo del contrato.']);
  if (contrato.incluye_poliza_responsabilidad_civil) polizas.push(['Póliza de responsabilidad civil', 'Vigencia igual al plazo del contrato.']);
  if (contrato.incluye_poliza_estabilidad) polizas.push(['Póliza de estabilidad', `Vigencia igual al período de garantía de la obra${contrato.garantia_meses ? ` (${contrato.garantia_meses} meses).` : '.'}`]);
  if (contrato.incluye_poliza_garantia) polizas.push(['Póliza de garantía', 'Vigencia igual al plazo del contrato más el período de garantía.']);
  if (contrato.incluye_poliza_calidad) polizas.push(['Póliza de calidad', 'Ampara la buena calidad de los materiales y de la obra ejecutada, con vigencia igual al período de garantía.']);

  const etiquetaContraparte = contrato.tipo_contrato === 'SUMINISTROS' ? 'Proveedor' : 'Contratista';

  return (
    <Document>
      <Page size="A4" style={estilos.pagina}>
        <EncabezadoPDF
          tituloDocumento={`Contrato ${numero}`}
          nombreObra={proyecto?.nombre}
          mostrarMarcaHabitatum={mostrarMarcaHabitatum}
          nombreEmisor={nombreEmisor}
        />
        <Text style={estilos.tituloDoc}>{tituloDoc}</Text>

        <Text style={estilos.tituloSeccion}>Información del Contratante</Text>
        <TablaInfo filas={[
          ['Nombre', proyecto?.cliente],
          ['NIT', proyecto?.nit_empresa],
          ['Representante legal', proyecto?.representante_legal],
          ['Teléfono', proyecto?.telefono_empresa],
        ]} />

        <Text style={estilos.tituloSeccion}>{`Información del ${etiquetaContraparte}`}</Text>
        <TablaInfo filas={[
          ['Nombre', proveedor?.nombre],
          ['NIT', proveedor?.nit],
          ['Representante legal', proveedor?.representante_legal],
          ['Teléfono', proveedor?.telefono],
        ]} />

        <Text style={estilos.tituloSeccion}>Datos de la obra y del contrato</Text>
        <TablaInfo filas={[
          ['Nombre de la obra', proyecto?.nombre],
          ['Dirección de la obra', [proyecto?.direccion_obra, proyecto?.ciudad].filter(Boolean).join(', ')],
          ['Descripción / alcance', contrato.alcance_detallado || contrato.concepto],
          ['Fecha de inicio', fechaFormateada(contrato.fecha_inicio)],
          ['Plazo de entrega', contrato.plazo_valor ? `${contrato.plazo_valor} ${contrato.plazo_unidad || ''}` : '-'],
          ['Fecha del contrato', fechaFormateada(contrato.fecha_contrato)],
          ['Valor del contrato', formatoPesos(contrato.valor_inicial)],
          ['Garantía de la obra', contrato.garantia_meses ? `${contrato.garantia_meses} meses desde la entrega` : '-'],
        ]} />

        {polizas.length > 0 ? (
          <>
            <Text style={estilos.tituloSeccion}>Pólizas aplicables a este contrato</Text>
            <TablaInfo filas={polizas} />
          </>
        ) : (
          <Text style={estilos.notaSinPolizas}>Este contrato no tiene pólizas ni anticipo marcados.</Text>
        )}

        {items.length > 0 && (
          <>
            <Text style={estilos.tituloSeccion}>Cuadro de ítems (informativo)</Text>
            <View style={estilos.tablaItems}>
              <View style={estilos.itemsEncabezado}>
                <Text style={estilos.colDescripcion}>Descripción</Text>
                <Text style={estilos.colUnidad}>Unidad</Text>
                <Text style={estilos.colCantidad}>Cantidad</Text>
                <Text style={estilos.colValorUnitario}>Valor unitario</Text>
                <Text style={estilos.colTotal}>Total</Text>
              </View>
              {items.map((it, i) => (
                <View key={i} style={estilos.itemsFila}>
                  <Text style={estilos.colDescripcion}>{it.descripcion}</Text>
                  <Text style={estilos.colUnidad}>{it.unidad}</Text>
                  <Text style={estilos.colCantidad}>{it.cantidad}</Text>
                  <Text style={estilos.colValorUnitario}>{formatoPesos(it.valorUnitario)}</Text>
                  <Text style={estilos.colTotal}>{formatoPesos(it.total)}</Text>
                </View>
              ))}
              <View style={estilos.itemsFilaTotal}>
                <Text style={{ flex: 5.3, textAlign: 'right', paddingRight: 6 }}>Total</Text>
                <Text style={estilos.colTotal}>{formatoPesos(totalItems)}</Text>
              </View>
            </View>
          </>
        )}

        {clausulas.map((cl) => (
          <View key={cl.id} wrap={false}>
            <Text style={estilos.clausulaTitulo}>{cl.titulo}</Text>
            <Text style={estilos.clausulaTexto}>{cl.texto}</Text>
          </View>
        ))}

        <View style={estilos.firmas}>
          <View style={estilos.lineaFirma}>
            <Text style={estilos.rayaFirma}>{`${proyecto?.cliente || 'Contratante'} (Contratante)`}</Text>
          </View>
          <View style={estilos.lineaFirma}>
            <Text style={estilos.rayaFirma}>{`${proveedor?.nombre || etiquetaContraparte} (${etiquetaContraparte})`}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
