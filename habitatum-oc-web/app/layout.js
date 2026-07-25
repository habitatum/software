import './globals.css';

export const metadata = {
  title: 'HABITATUM · Órdenes de Compra',
  description: 'Sistema de Contratos, Proveedores y Órdenes de Compra',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
}
