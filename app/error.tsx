'use client';

import Link from 'next/link';

export default function CatalogError({ reset }: { reset: () => void }) {
  return <main className="shell empty-state" role="alert"><h1>The catalog couldn’t load.</h1>
    <p>Try again. If the problem continues, the local course snapshot may need attention.</p>
    <button className="button" onClick={reset}>Try again</button><Link className="back-link" href="/">Return to course search</Link></main>;
}
