import { useAuth } from './lib/auth';
import { useRoute, match } from './lib/router';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Day } from './screens/Day';
import { Report } from './screens/Report';
import { FamilyScreen } from './screens/Family';
import { Admin } from './screens/Admin';
import { Spinner } from './components/ui';

export function App() {
  const { user, loading } = useAuth();
  const route = useRoute();

  if (loading) return <Spinner />;
  if (!user) return <Login />;

  const report = match(route, '/session/:id/report');
  if (report) return <Report sessionId={report.id} />;

  const day = match(route, '/session/:id');
  if (day) return <Day sessionId={day.id} />;

  if (match(route, '/admin')) return <Admin />;

  const family = match(route, '/family/:id');
  if (family) return <FamilyScreen familyId={family.id} />;

  return <Home />;
}
