// --- Core shapes -------------------------------------------------------------

export interface Business {
  id: string; name: string; defaultRateCents: number; currency: string;
  createdAt?: string;
  stats?: { clients: number; shifts: number; upcoming: number };
}

export interface ParentLink { id: string; name: string; businessName: string }

export interface User {
  id: string; email: string; name: string;
  isAdmin: boolean;
  business: { id: string; name: string } | null;
  parentOf: ParentLink[];
}

/** The minimum a timeline block or quick-add form needs to render a child. */
export interface ShiftChild { id: string; name: string; colour: string }

export interface Child {
  id: string; clientId: string; name: string; birthdate: string | null;
  colour: string; allergies: string; medical: string; routines: string;
  notes: string; archived: boolean;
}

export interface Contact {
  id: string; clientId: string; name: string; email: string; phone: string;
  relationship: string; isPrimary: boolean; receivesReports: boolean;
  isEmergency: boolean; canCollect: boolean;
}

export interface Client {
  id: string; businessId: string; name: string; address: string;
  rateCents: number | null; notes: string; houseRules: string; wifi: string;
  archived: boolean; createdAt: string;
  access?: 'owner' | 'parent';
  children?: Child[];
  contacts?: Contact[];
  parents?: { id: string; name: string; email: string; since: string }[];
  shifts?: Shift[];
  lastShift?: string | null;
  upcomingShifts?: number;
}

export type ShiftStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface LogEvent {
  id: string; shiftId: string; childId: string; type: string;
  startAt: string; endAt: string | null; note: string;
  detail: Record<string, unknown>; createdAt: string; updatedAt: string;
}

export interface Shift {
  id: string; businessId: string; clientId: string; sitterUserId: string;
  date: string;
  scheduledStart: string | null; scheduledEnd: string | null;
  startedAt: string | null; endedAt: string | null; cancelledAt: string | null;
  rateCents: number | null; notes: string; parentNotes: string;
  reportSentAt: string | null; invoiceId: string | null;
  status: ShiftStatus; minutes: number | null;
  client?: Client;
  clientName?: string;
  children?: ShiftChild[];
  events?: LogEvent[];
  sitterName?: string;
  eventCount?: number;
  access?: 'owner' | 'parent';
}

export interface Invite { code: string; email?: string; expiresAt: string; createdAt: string }

export interface InvoiceItem {
  shiftId: string; date: string; startedAt: string; endedAt: string;
  minutes: number; duration: string; rateCents: number; amountCents: number;
  children: string[];
}

export interface Invoice {
  id: string; businessId: string; clientId: string; number: number;
  periodStart: string; periodEnd: string; minutes: number;
  totalCents: number; currency: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  notes: string; sentAt: string | null; paidAt: string | null; createdAt: string;
  clientName?: string; businessName?: string; shiftCount?: number;
  items?: InvoiceItem[];
}

export interface InvoicePreview {
  clientId: string; clientName: string; periodStart: string; periodEnd: string;
  currency: string; items: InvoiceItem[]; minutes: number; totalCents: number;
}

export interface Earnings {
  status: ShiftStatus; minutes: number; rateCents: number;
  currency: string; totalCents: number; invoiced: boolean;
}

export interface SendResult {
  sent: number; configured?: boolean; noRecipients?: boolean;
  results: { email: string; ok: boolean; error?: string; skipped?: boolean }[];
}

// --- Transport ---------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = (isJson && (payload as { error?: string }).error) || 'Something went wrong';
    throw new ApiError(res.status, message);
  }
  return payload as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const del = <T>(p: string, b?: unknown) => request<T>('DELETE', p, b);

export interface EventInput {
  type?: string; childId?: string; startAt?: string; endAt?: string | null;
  note?: string; detail?: Record<string, unknown>;
}

export const api = {
  // Identity
  me: () => get<{ user: User }>('/api/auth/me').then((r) => r.user),
  login: (email: string, password: string) =>
    post<{ user: User }>('/api/auth/login', { email, password }).then((r) => r.user),
  register: (input: { email: string; password: string; name: string; businessName?: string; inviteCode?: string }) =>
    post<{ user: User }>('/api/auth/register', input).then((r) => r.user),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  joinClient: (inviteCode: string) =>
    post<{ user: User }>('/api/auth/join', { inviteCode }).then((r) => r.user),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/auth/password', { currentPassword, newPassword }),

  // Business
  business: () => get<{ business: Business | null }>('/api/business').then((r) => r.business),
  createBusiness: (input: { name: string; defaultRate?: number; currency?: string }) =>
    post<{ business: Business }>('/api/business', input).then((r) => r.business),
  updateBusiness: (input: { name?: string; defaultRate?: number; currency?: string }) =>
    patch<{ business: Business }>('/api/business', input).then((r) => r.business),

  // Clients
  clients: (includeArchived = false) =>
    get<{ clients: Client[] }>(`/api/clients${includeArchived ? '?includeArchived=true' : ''}`).then((r) => r.clients),
  client: (id: string) => get<{ client: Client }>(`/api/clients/${id}`).then((r) => r.client),
  createClient: (input: Partial<Client> & { name: string; rate?: number }) =>
    post<{ client: Client }>('/api/clients', input).then((r) => r.client),
  updateClient: (id: string, input: Record<string, unknown>) =>
    patch<{ client: Client }>(`/api/clients/${id}`, input).then((r) => r.client),
  deleteClient: (id: string, confirmName: string) => del(`/api/clients/${id}`, { confirmName }),

  createChild: (clientId: string, input: Record<string, unknown>) =>
    post<{ child: Child }>(`/api/clients/${clientId}/children`, input).then((r) => r.child),
  updateChild: (clientId: string, childId: string, input: Record<string, unknown>) =>
    patch<{ child: Child }>(`/api/clients/${clientId}/children/${childId}`, input).then((r) => r.child),
  deleteChild: (clientId: string, childId: string) => del(`/api/clients/${clientId}/children/${childId}`),

  createContact: (clientId: string, input: Record<string, unknown>) =>
    post<{ contact: Contact }>(`/api/clients/${clientId}/contacts`, input).then((r) => r.contact),
  updateContact: (clientId: string, contactId: string, input: Record<string, unknown>) =>
    patch<{ contact: Contact }>(`/api/clients/${clientId}/contacts/${contactId}`, input).then((r) => r.contact),
  deleteContact: (clientId: string, contactId: string) => del(`/api/clients/${clientId}/contacts/${contactId}`),

  invites: (clientId: string) =>
    get<{ invites: Invite[] }>(`/api/clients/${clientId}/invites`).then((r) => r.invites),
  createInvite: (clientId: string, email?: string) =>
    post<{ invite: Invite }>(`/api/clients/${clientId}/invites`, { email }).then((r) => r.invite),
  revokeInvite: (clientId: string, code: string) => del(`/api/clients/${clientId}/invites/${code}`),
  revokeParent: (clientId: string, userId: string) => del(`/api/clients/${clientId}/parents/${userId}`),

  // Shifts
  shifts: (scope: 'all' | 'upcoming' | 'active' | 'past' = 'all', clientId?: string) =>
    get<{ shifts: Shift[] }>(`/api/shifts?scope=${scope}${clientId ? `&clientId=${clientId}` : ''}`).then((r) => r.shifts),
  shift: (id: string) => get<{ shift: Shift }>(`/api/shifts/${id}`).then((r) => r.shift),
  createShift: (input: {
    clientId: string; startNow?: boolean; scheduledStart?: string; scheduledEnd?: string;
    childIds?: string[]; parentNotes?: string; rate?: number;
  }) => post<{ shift: Shift }>('/api/shifts', input).then((r) => r.shift),
  updateShift: (id: string, input: Record<string, unknown>) =>
    patch<{ shift: Shift }>(`/api/shifts/${id}`, input).then((r) => r.shift),
  startShift: (id: string, startedAt?: string) =>
    post<{ shift: Shift }>(`/api/shifts/${id}/start`, { startedAt }).then((r) => r.shift),
  endShift: (id: string, input: { endedAt?: string; notes?: string }) =>
    post<{ shift: Shift }>(`/api/shifts/${id}/end`, input).then((r) => r.shift),
  cancelShift: (id: string) => post<{ shift: Shift }>(`/api/shifts/${id}/cancel`).then((r) => r.shift),
  deleteShift: (id: string) => del(`/api/shifts/${id}`),
  earnings: (id: string) => get<{ earnings: Earnings }>(`/api/shifts/${id}/earnings`).then((r) => r.earnings),

  // Events
  createEvent: (shiftId: string, input: EventInput) =>
    post<{ event: LogEvent }>(`/api/shifts/${shiftId}/events`, input).then((r) => r.event),
  updateEvent: (eventId: string, input: EventInput) =>
    patch<{ event: LogEvent }>(`/api/events/${eventId}`, input).then((r) => r.event),
  stopEvent: (eventId: string, input: { endAt?: string; detail?: Record<string, unknown>; note?: string }) =>
    post<{ event: LogEvent }>(`/api/events/${eventId}/stop`, input).then((r) => r.event),
  deleteEvent: (eventId: string) => del(`/api/events/${eventId}`),

  // Reports
  report: (shiftId: string) => get<{ report: Report }>(`/api/shifts/${shiftId}/report`).then((r) => r.report),
  reportText: (shiftId: string) =>
    fetch(`/api/shifts/${shiftId}/report.txt`, { credentials: 'same-origin' }).then((r) => r.text()),

  // Invoicing
  invoices: (clientId?: string) =>
    get<{ invoices: Invoice[] }>(`/api/invoices${clientId ? `?clientId=${clientId}` : ''}`).then((r) => r.invoices),
  invoice: (id: string) => get<{ invoice: Invoice }>(`/api/invoices/${id}`).then((r) => r.invoice),
  invoicePreview: (clientId: string, periodStart?: string, periodEnd?: string) =>
    get<{ preview: InvoicePreview }>(
      `/api/invoices/preview?clientId=${clientId}` +
      (periodStart ? `&periodStart=${periodStart}` : '') +
      (periodEnd ? `&periodEnd=${periodEnd}` : ''),
    ).then((r) => r.preview),
  createInvoice: (input: { clientId: string; periodStart?: string; periodEnd?: string; notes?: string }) =>
    post<{ invoice: Invoice }>('/api/invoices', input).then((r) => r.invoice),
  updateInvoice: (id: string, input: { status?: string; notes?: string }) =>
    patch<{ invoice: Invoice }>(`/api/invoices/${id}`, input).then((r) => r.invoice),
  sendInvoice: (id: string) => post<{ result: SendResult }>(`/api/invoices/${id}/send`).then((r) => r.result),
  deleteInvoice: (id: string) => del(`/api/invoices/${id}`),
};

// --- Report shapes -----------------------------------------------------------

export interface ReportEntry {
  id?: string; at: string; end?: string | null; minutes?: number | null; note?: string;
  [key: string]: unknown;
}

export interface ChildReport {
  child: { id: string; name: string; colour: string };
  sleep: { napCount: number; inProgress: number; totalMinutes: number; longestMinutes: number; naps: ReportEntry[] };
  food: {
    bottleCount: number; totalOz: number; bottles: ReportEntry[];
    mealCount: number; feedings: ReportEntry[];
    snackCount: number; snacks: ReportEntry[];
    waterCount: number; totalWaterOz: number; waters: ReportEntry[];
  };
  diapering: {
    total: number; wet: number; dirty: number; diapers: ReportEntry[];
    pottyCount: number; pottyAccidents: number; pottyTrips: ReportEntry[];
  };
  activities: {
    totalMinutes: number; items: ReportEntry[];
    screenMinutes: number; screenTime: ReportEntry[]; quiet: ReportEntry[]; baths: ReportEntry[];
  };
  health: { medications: ReportEntry[]; incidents: ReportEntry[] };
  observations: { milestones: ReportEntry[]; notes: ReportEntry[]; photos: ReportEntry[] };
}

export interface Report {
  shift: {
    id: string; date: string; startedAt: string; endedAt: string | null;
    durationMinutes: number | null; notes: string; parentNotes: string;
    sitterName: string; clientName: string; businessName: string;
  };
  children: ChildReport[];
  generatedAt: string;
}

// --- Admin -------------------------------------------------------------------

export interface AdminOverview {
  counts: Record<string, number>;
  storage: { dbBytes: number; walBytes: number; path: string };
  mail: {
    configured: boolean; host: string; port: number; secure: boolean; from: string;
    authenticated: boolean; adminCount: number; warnings: string[];
    recentFailures: { to_email: string; subject: string; error: string; created_at: string }[];
  };
  runtime: { uptimeSeconds: number; node: string; rssBytes: number; now: string };
  activity: { last7Days: { date: string; shifts: number }[] };
}

export interface AdminUser {
  id: string; email: string; name: string; disabled: boolean;
  createdAt: string; lastSeenAt: string | null;
  business: { id: string; name: string } | null;
  parentOf: { id: string; name: string }[];
}

export interface AdminBusiness {
  id: string; name: string; currency: string; defaultRateCents: number;
  createdAt: string; ownerName: string; ownerEmail: string;
  clients: number; shifts: number;
}

export interface AdminBusinessDetail {
  id: string; name: string; currency: string; defaultRateCents: number; createdAt: string;
  owner: { id: string; name: string; email: string };
  clients: { id: string; name: string; archived: number; children: number; shifts: number; parents: number }[];
}

export interface AdminShift {
  id: string; clientId: string; clientName: string; businessName: string; sitterName: string;
  date: string; startedAt: string | null; endedAt: string | null;
  status: ShiftStatus; minutes: number | null; reportSentAt: string | null; events: number;
}

export interface EmailLogEntry {
  id: string; shiftId: string | null; invoiceId: string | null; to: string;
  subject: string; status: 'sent' | 'failed' | 'skipped'; error: string; createdAt: string;
}

export const admin = {
  overview: () => get<AdminOverview>('/api/admin/overview'),
  users: (q = '') => get<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.users),
  updateUser: (id: string, input: { disabled?: boolean; name?: string }) =>
    patch<{ user: AdminUser }>(`/api/admin/users/${id}`, input).then((r) => r.user),
  resetPassword: (id: string, newPassword: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/password`, { newPassword }),
  deleteUser: (id: string, force = false) =>
    del<{ ok: true }>(`/api/admin/users/${id}${force ? '?force=true' : ''}`),

  businesses: () => get<{ businesses: AdminBusiness[] }>('/api/admin/businesses').then((r) => r.businesses),
  business: (id: string) => get<{ business: AdminBusinessDetail }>(`/api/admin/businesses/${id}`).then((r) => r.business),
  deleteBusiness: (id: string, confirmName: string) =>
    del<{ ok: true }>(`/api/admin/businesses/${id}`, { confirmName }),

  shifts: (clientId?: string) =>
    get<{ shifts: AdminShift[] }>(`/api/admin/shifts${clientId ? `?clientId=${clientId}` : ''}`).then((r) => r.shifts),
  resendReport: (shiftId: string) =>
    post<{ result: SendResult }>(`/api/admin/shifts/${shiftId}/resend-report`).then((r) => r.result),

  emailLog: (status = '') =>
    get<{ entries: EmailLogEntry[] }>(`/api/admin/email-log${status ? `?status=${status}` : ''}`).then((r) => r.entries),
  verifyMail: () => post<{ result: { ok: boolean; error?: string; warnings?: string[] } }>('/api/admin/mail/verify').then((r) => r.result),
  testMail: (to: string) =>
    post<{ result: { ok: boolean; error?: string; skipped?: boolean } }>('/api/admin/mail/test', { to }).then((r) => r.result),

  vacuum: () => post<{ beforeBytes: number; afterBytes: number }>('/api/admin/maintenance/vacuum'),
  backup: () => post<{ path: string; bytes: number }>('/api/admin/maintenance/backup'),
  prune: () => post<{ expiredLogins: number; expiredInvites: number; oldEmailLogs: number }>('/api/admin/maintenance/prune'),
};
