import { useState } from 'react';
import { FindingsView } from './components/FindingsView';
import { PayAppEntry } from './components/PayAppEntry';
import { ProjectProfileForm } from './components/ProjectProfileForm';
import { defaultPayApp } from './state/payApp';
import { defaultProfile } from './state/profile';

type Section = 'profile' | 'payapp' | 'findings';

const TABS: ReadonlyArray<{ value: Section; label: string }> = [
  { value: 'profile', label: 'Project profile' },
  { value: 'payapp', label: 'Pay application' },
  { value: 'findings', label: 'Findings' },
];

export const App = () => {
  const [section, setSection] = useState<Section>('profile');
  const [profile, setProfile] = useState(defaultProfile);
  const [payApp, setPayApp] = useState(defaultPayApp);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <h1 className="text-xl font-semibold text-slate-900">
            C3 Forensic GMP Review
          </h1>
          <p className="text-sm text-slate-600">
            Owner-side audit of GMP pay applications. All data stays in your browser.
          </p>
          <nav className="mt-4 flex gap-1 border-b border-slate-200" role="tablist">
            {TABS.map((tab) => {
              const active = tab.value === section;
              return (
                <button
                  key={tab.value}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSection(tab.value)}
                  className={
                    'border-b-2 px-3 py-2 text-sm font-medium ' +
                    (active
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-700')
                  }
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {section === 'profile' && (
          <ProjectProfileForm profile={profile} onChange={setProfile} />
        )}
        {section === 'payapp' && (
          <PayAppEntry payApp={payApp} onChange={setPayApp} />
        )}
        {section === 'findings' && (
          <FindingsView profile={profile} payApp={payApp} />
        )}
      </main>
    </div>
  );
};
