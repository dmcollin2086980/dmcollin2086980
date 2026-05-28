import { useState } from 'react';
import { ProjectProfileForm } from './components/ProjectProfileForm';
import { defaultProfile } from './state/profile';

export const App = () => {
  const [profile, setProfile] = useState(defaultProfile);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <h1 className="text-xl font-semibold text-slate-900">
            C3 Forensic GMP Review
          </h1>
          <p className="text-sm text-slate-600">
            Owner-side audit of GMP pay applications. All data stays in your browser.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Project profile</h2>
        <ProjectProfileForm profile={profile} onChange={setProfile} />
      </main>
    </div>
  );
};
