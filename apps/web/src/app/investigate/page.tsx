import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InvestigateClient } from '@/components/investigate/InvestigateClient';
import { Skeleton } from '@/components/ui/feedback';

export const metadata: Metadata = {
  title: '地址調查',
  description: '輸入 ETH / BSC / TRON / BTC 地址，取得風險分數、規則命中、ML 異常偵測、關聯圖與 AI Agent 調查報告。',
};

export default function InvestigatePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <InvestigateClient />
    </Suspense>
  );
}
