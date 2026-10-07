import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsClient } from '@/components/reports/ReportsClient';
import { Skeleton } from '@/components/ui/feedback';

export const metadata: Metadata = {
  title: '調查報告',
  description: 'AI Agent 產生的地址風險調查報告與執行軌跡。',
};

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ReportsClient />
    </Suspense>
  );
}
