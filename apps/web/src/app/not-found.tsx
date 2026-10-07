import Link from 'next/link';
import { Compass } from 'lucide-react';
import { buttonClass } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <Compass className="size-10 text-ink-3" aria-hidden />
      <h1 className="text-xl font-bold text-ink">找不到此頁面</h1>
      <p className="text-sm text-ink-2">網址可能有誤，或頁面已被移除。</p>
      <Link href="/" className={buttonClass('primary', 'md', 'mt-2')}>
        回到儀表板
      </Link>
    </div>
  );
}
