import Link from 'next/link';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };
export default function AdminPage() {
  return <main className="mx-auto max-w-5xl p-8"><p className="text-sm">Wellness Fit Check</p><h1 className="my-4 text-3xl font-semibold">Admin</h1><Link className="underline" href="/admin/traffic">Traffic &amp; conversions →</Link></main>;
}
