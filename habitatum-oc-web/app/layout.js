import { Cormorant_Garamond } from 'next/font/google';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
});

export const metadata = {
  title: 'HABITATUM · Órdenes de Compra',
  description: 'Sistema de Contratos, Proveedores y Órdenes de Compra',
  icons: { icon: '/logo-habitatum.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={cormorant.variable}>
      <body className="bg-hueso text-neutral-900">{children}</body>
    </html>
  );
}
