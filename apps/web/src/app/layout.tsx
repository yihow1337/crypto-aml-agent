import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Noto_Sans_TC } from 'next/font/google';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import './globals.css';

const notoSansTc = Noto_Sans_TC({
  subsets: ['latin'],
  variable: '--font-noto-sans-tc',
  display: 'swap',
  // CJK fonts are split into many unicode-range files; let the browser fetch only what it needs.
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Crypto AML Agent — AI 鏈上風險監控與異常交易偵測',
    template: '%s｜Crypto AML Agent',
  },
  description:
    'AI 鏈上風險監控與異常交易偵測系統：多鏈地址風險評分、OFAC 制裁篩查、21 條 AML 偵測規則、Isolation Forest 異常偵測與 GLM AI Agent 調查報告。',
  applicationName: 'Crypto AML Agent',
};

export const viewport: Viewport = {
  themeColor: '#0b1220',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" className={`${notoSansTc.variable} ${jetbrainsMono.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-white"
        >
          跳至主要內容
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
