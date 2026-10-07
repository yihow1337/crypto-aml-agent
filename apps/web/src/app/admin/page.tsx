import type { Metadata } from 'next';
import { AdminClient } from '@/components/admin/AdminClient';

export const metadata: Metadata = {
  title: '管理後台',
  description: '系統用量、排程任務與濫用監控（需管理員權杖）。',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminClient />;
}
