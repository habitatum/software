import fs from 'fs';
import path from 'path';
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';
import { numeroEnLetras } from './documentoContrato';

// RECIBO DE CAJA MENOR (065). Media hoja A4 horizontal (595 × 421 pt): así ocupa exacto la mitad de
// la hoja de comprobantes del PDF de la OC de legalización. Sin precios de venta ni utilidad.
const CARBON = '#2e2e2e';
const DORADO = '#b88a52';
const HUESO = '#efece6';
const GRIS = '#cdc5ba';
const SUAVE = '#6b655d';

let FUENTE = 'Helvetica';
let NEGRITA = { fontFamily: 'Helvetica-Bold' };
try {
  const dir = path.join(process.cwd(), 'public', 'fonts');
  if (fs.existsSync(path.join(dir, 'LiberationSans-Regular.ttf'))) {
    Font.register({ family: 'Arial', fonts: [
      { src: path.join(dir, 'LiberationSans-Regular.ttf') },
      { src: path.join(dir, 'LiberationSans-Bold.ttf'), fontWeight: 'bold' },
    ] });
    Font.registerHyphenationCallback((w) => [w]);
    FUENTE = 'Arial';
    NEGRITA = { fontFamily: 'Arial', fontWeight: 'bold' };
  }
} catch { /* Helvetica */ }

let logo = null;
try {
  logo = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), 'public', 'logo-habitatum-pdf.png')).toString('base64')}`;
} catch { logo = null; }

const e = StyleSheet.create({
  pagina: { fontFamily: FUENTE, fontSize: 8.5, color: CARBON, padding: 0 },
  banda: { backgroundColor: CARBON, color: 'white', paddingVertical: 10, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center' },
  logo: { width: 18, height: 28, marginRight: 10 },
  empresa: { fontSize: 13, ...NEGRITA },
  obra: { fontSize: 8, color: GRIS, marginTop: 2 },
  titulo: { fontSize: 11, color: DORADO, ...NEGRITA, textAlign: 'right' },
  folio: { fontSize: 13, ...NEGRITA, textAlign: 'right', marginTop: 2 },
  cuerpo: { paddingHorizontal: 22, paddingTop: 10 },
  filaValor: { flexDirection: 'row', borderWidth: 0.6, borderColor: GRIS, borderRadius: 3, marginBottom: 8 },
  celdaValor: { width: '34%', backgroundColor: HUESO, padding: 7, borderRightWidth: 1, borderRightColor: DORADO },
  et: { fontSize: 7, color: SUAVE, marginBottom: 2 },
  valor: { fontSize: 15, ...NEGRITA },
  letras: { width: '66%', padding: 7 },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: HUESO, paddingVertical: 4 },
  etFila: { width: '24%', color: SUAVE },
  vaFila: { width: '76%' },
  leyenda: { marginTop: 8, fontSize: 7.5, color: '#7a5a30', backgroundColor: '#f6efe6', padding: 5, borderRadius: 2 },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  firma: { width: '44%', borderTopWidth: 0.6, borderTopColor: CARBON, paddingTop: 3 },
  pie: { position: 'absolute', bottom: 10, left: 22, right: 22, fontSize: 6.5, color: SUAVE, flexDirection: 'row', justifyContent: 'space-between' },
});

const pesos = (v) => `$ ${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
function fechaTexto(f) {
  if (!f) return '';
  const [a, m, d] = String(f).slice(0, 10).split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d} de ${meses[m - 1]} de ${a}`;
}
function letras(v) {
  const n = Math.round(Math.abs(Number(v) || 0));
  return `${numeroEnLetras(n)}${n > 0 && n % 1e6 === 0 ? ' DE' : ''} PESOS M/CTE.`;
}
function Fila({ et, va }) {
  return <View style={e.fila}><Text style={e.etFila}>{et}</Text><Text style={e.vaFila}>{va || '—'}</Text></View>;
}

export default function PlantillaReciboCajaMenorPDF({ r }) {
  const p = r.proyecto || {};
  const conMarca = p.mostrar_marca_habitatum !== false;
  const emisor = conMarca ? 'HABITATUM' : (p.nombre_emisor || '');
  const benef = [r.beneficiario_nombre, r.beneficiario_documento].filter(Boolean).join(' · ');
  return (
    <Document title={`${r.recibo_folio} · Recibo de caja menor`} author={emisor}>
      <Page size={[595.28, 420.94]} style={e.pagina}>
        <View style={e.banda}>
          {conMarca && logo && <Image src={logo} style={e.logo} />}
          <View style={{ flex: 1 }}>
            <Text style={e.empresa}>{emisor}</Text>
            <Text style={e.obra}>Obra: {p.nombre || ''}{conMarca && p.nit_empresa ? ` · NIT ${p.nit_empresa}` : ''}</Text>
          </View>
          <View>
            <Text style={e.titulo}>RECIBO DE CAJA MENOR</Text>
            <Text style={e.folio}>No. {r.recibo_folio}</Text>
          </View>
        </View>
        <View style={e.cuerpo}>
          <View style={e.filaValor}>
            <View style={e.celdaValor}><Text style={e.et}>VALOR</Text><Text style={e.valor}>{pesos(r.valor)}</Text></View>
            <View style={e.letras}><Text style={e.et}>LA SUMA DE</Text><Text style={NEGRITA}>{letras(r.valor)}</Text></View>
          </View>
          <Fila et="Fecha" va={`${p.ciudad ? `${p.ciudad}, ` : ''}${fechaTexto(r.fecha)}`} />
          <Fila et="Pagado a" va={benef} />
          {r.beneficiario_cuenta ? <Fila et="Cuenta / medio de pago" va={r.beneficiario_cuenta} /> : null}
          <Fila et="Por concepto de" va={r.concepto} />
          <Fila et="Capítulo" va={[r.capitulo, r.item].filter(Boolean).join(' · ')} />
          <Fila et="Registrado por" va={r.remitente ? `${r.remitente} (bot de finanzas de la obra)` : 'App HABITATUM'} />
          <Text style={e.leyenda}>Recibo generado sin soporte del proveedor. El beneficiario declara haber recibido el valor indicado por el concepto descrito.</Text>
          <View style={e.firmas}>
            <View style={e.firma}><Text style={NEGRITA}>Firma del beneficiario</Text><Text style={{ color: SUAVE, fontSize: 7 }}>Nombre y CC/NIT: {benef || '______________________________'}</Text></View>
            <View style={e.firma}><Text style={NEGRITA}>Entregó</Text><Text style={{ color: SUAVE, fontSize: 7 }}>{emisor}</Text></View>
          </View>
        </View>
        <View style={e.pie} fixed>
          <Text>{r.recibo_folio} · {p.nombre || ''}</Text>
          <Text>Generado el {new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}</Text>
        </View>
      </Page>
    </Document>
  );
}
