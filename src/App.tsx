// App shell — macOS window chrome (titlebar + traffic lights), top nav, and routing.
// First-run gate: no UserProfile -> Onboarding; otherwise the chosen route (default Home).
import { useEffect } from 'react';
import { RouterProvider, useRouter, type Route } from './router';
import { useProfile } from './lib/useProfile';
import { HomePage } from './pages/HomePage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PracticePage } from './pages/PracticePage';
import { ReportPage } from './pages/ReportPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { ConversationPage } from './ConversationPage';

const NAV: { route: Route; label: string }[] = [
  { route: 'home', label: '首页' },
  { route: 'practice', label: '训练' },
  { route: 'conversation', label: '对话' },
  { route: 'report', label: '进步' },
  { route: 'settings', label: '设置' },
];

function Shell() {
  const { route, navigate } = useRouter();
  const { profile, loading, reload } = useProfile();

  // First-run gate: force onboarding until a profile exists.
  useEffect(() => {
    if (loading) return;
    if (!profile && route !== 'onboarding') navigate('onboarding');
  }, [loading, profile, route, navigate]);

  const onboarding = route === 'onboarding' || (!loading && !profile);

  return (
    <div className="app-shell">
      <div className="es-titlebar">
        <span className="es-win-title">EchoSpeak AI</span>
        {!onboarding && (
          <nav className="es-nav">
            {NAV.map((n) => (
              <button
                key={n.route}
                className={`es-nav-item ${route === n.route ? 'on' : ''}`}
                onClick={() => navigate(n.route)}
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="app-body">
        {loading ? (
          <div className="app-loading">加载中…</div>
        ) : onboarding ? (
          <OnboardingPage onDone={reload} />
        ) : route === 'home' && profile ? (
          <HomePage profile={profile} />
        ) : route === 'practice' ? (
          <PracticePage profile={profile} />
        ) : route === 'conversation' ? (
          <ConversationPage />
        ) : route === 'report' ? (
          <ReportPage profile={profile} />
        ) : route === 'review' ? (
          <ReviewPage profile={profile} />
        ) : route === 'settings' ? (
          <SettingsPage profile={profile} onProfileChange={reload} />
        ) : profile ? (
          <HomePage profile={profile} />
        ) : null}
      </div>
    </div>
  );
}

export function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}
