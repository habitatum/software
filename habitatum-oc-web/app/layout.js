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
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    title: 'HABITATUM',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport = {
  themeColor: '#2E2E2E',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={cormorant.variable}>
      <body className="bg-hueso text-neutral-900">{children}</body>
    </html>
  );
}
