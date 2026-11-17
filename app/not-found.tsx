import Link from 'next/link';
export default function NotFound() {
  return <main className="shell empty-state"><h1>Course not found.</h1><p>This course may belong to a different catalog.</p><Link href="/">Return to course search →</Link></main>;
}
