import { useAuth } from './lib/auth';
import { useRoute, match } from './lib/router';
import { Login } from './screens/Login';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';
import { Clients } from './screens/Clients';
import { ClientDetail } from './screens/ClientDetail';
import { Shift } from './screens/Shift';
import { Report } from './screens/Report';
import { Invoices, InvoiceDetail } from './screens/Invoices';
import { Settings } from './screens/Settings';
import { ParentHome } from './screens/ParentHome';
import { Admin } from './screens/Admin';
import { Spinner } from './components/ui';

export function App() {
  const { user, loading } = useAuth();
  const route = useRoute();

  if (loading) return <Spinner />;
  if (!user) return <Login />;

  if (match(route, '/admin')) return <Admin />;

  // Shared between sitters and parents; the API decides what each may see, and
  // the screens render read-only when access is 'parent'.
  const report = match(route, '/shift/:id/report');
  if (report) return <Report shiftId={report.id} />;

  const shift = match(route, '/shift/:id');
  if (shift) return <Shift shiftId={shift.id} />;

  const client = match(route, '/client/:id');
  if (client) return <ClientDetail clientId={client.id} />;

  const isSitter = Boolean(user.business);

  if (isSitter) {
    if (match(route, '/clients')) return <Clients />;
    if (match(route, '/invoices')) return <Invoices />;
    if (match(route, '/settings')) return <Settings />;

    const invoice = match(route, '/invoice/:id');
    if (invoice) return <InvoiceDetail invoiceId={invoice.id} />;

    return <Today />;
  }

  if (user.parentOf.length > 0) return <ParentHome />;

  // Signed in but neither a sitter nor a parent — offer both paths.
  return <Onboarding />;
}
