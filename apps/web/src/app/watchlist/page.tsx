import type { Metadata } from 'next';
import { WatchlistClient } from '@/components/watchlist/WatchlistClient';

export const metadata: Metadata = {
  title: '監控名單',
  description: '持續監控的地址清單：排程掃描會定期重新評分並在風險升高時產生警示。',
};

export default function WatchlistPage() {
  return <WatchlistClient />;
}
