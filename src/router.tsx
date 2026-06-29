// Minimal hash-based router — zero dependencies, robust under Electron file://.
// Routes: #/home #/onboarding #/practice #/conversation #/report #/review #/settings
import { useEffect, useState, createContext, useContext } from 'react';

export type Route =
  | 'home'
  | 'onboarding'
  | 'practice'
  | 'conversation'
  | 'report'
  | 'review'
  | 'settings';

const ROUTES: Route[] = ['home', 'onboarding', 'practice', 'conversation', 'report', 'review', 'settings'];

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES.includes(h as Route) ? h : 'home') as Route;
}

interface NavCtx {
  route: Route;
  navigate: (r: Route) => void;
}
const RouterContext = createContext<NavCtx>({ route: 'home', navigate: () => {} });

export function useRouter() {
  return useContext(RouterContext);
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash());

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = `#/${r}`;
  };

  return (
    <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>
  );
}
