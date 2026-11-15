import { Link } from 'react-router-dom';
import { PROJECT_ABOUT } from '@diu/shared';
import { useAuth } from '../lib/auth';

const initials = (name: string) => name.split(' ').map((p) => p[0]).join('').slice(0, 2);

/** Public page: what the system is and who built it. */
export function AboutPage() {
  const { me } = useAuth();
  const back = !me ? '/login' : me.role === 'authority' ? '/admin' : '/app';
  return (
    <main className="mx-auto grid min-h-screen max-w-xl content-center gap-5 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>DIU</span>
        <div><h1 className="text-xl">About {PROJECT_ABOUT.name}</h1><p className="muted">{PROJECT_ABOUT.university}</p></div>
      </div>
      <section className="card grid gap-3">
        <p>{PROJECT_ABOUT.summary}</p>
        <h2 className="text-base">Created by</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROJECT_ABOUT.creators.map((name) => (
            <div key={name} className="tile flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{initials(name)}</span>
              <div><b>{name}</b><div className="muted text-xs">{PROJECT_ABOUT.department}</div></div>
            </div>
          ))}
        </div>
        <p className="muted text-xs">{PROJECT_ABOUT.department}, {PROJECT_ABOUT.university}.</p>
        <a className="text-xs" href={PROJECT_ABOUT.repository} target="_blank" rel="noreferrer">Source code on GitHub</a>
      </section>
      <Link className="btn justify-center" to={back}>Back</Link>
    </main>
  );
}

/** One-line credit with a link to the About page. */
export function CreditLine({ className = '' }: { className?: string }) {
  return (
    <p className={`muted text-xs ${className}`}>
      <Link to="/about" className="hover:underline">{PROJECT_ABOUT.creditLine} · {PROJECT_ABOUT.department}, DIU</Link>
    </p>
  );
}
