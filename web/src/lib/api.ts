export interface Family { id: string; name: string; role: 'parent' | 'sitter'; childCount?: number }
export interface User { id: string; email: string; name: string; families: Family[]; isAdmin: boolean }
export interface Child { id: string; name: string; birthdate: string | null; colour: string; notes: string; archived: boolean }
export interface SessionChild { id: string; name: string; colour: string; birthdate: string | null }

export interface LogEvent {
  id: string;
  sessionId: string;
  childId: string;
  type: string;
  startAt: string;
  endAt: string | null;
  note: string;
  detail: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  familyId: string;
  sitterUserId: string;
  sitterName?: string;
  date: string;
  startedAt: string;
  endedAt: string | null;
  notes: string;
  children: SessionChild[];
  events?: LogEvent[];
  eventCount?: number;
  role?: 'parent' | 'sitter';
}

export interface Member { id: string; name: string; email: string; role: 'parent' | 'sitter'; joinedAt: string }
export interface Invite { code: string; role: 'parent' | 'sitter'; expiresAt: string; createdAt: string }

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
const del = <T>(p: string) => request<T>('DELETE', p);

export interface EventInput {
  type: string;
  childId: string;
  startAt?: string;
  endAt?: string | null;
  note?: string;
  detail?: Record<string, unknown>;
}

export const api = {
  me: () => get<{ user: User }>('/api/auth/me').then((r) => r.user),
  login: (email: string, password: string) =>
    post<{ user: User }>('/api/auth/login', { email, password }).then((r) => r.user),
  register: (input: { email: string; password: string; name: string; familyName?: string; inviteCode?: string }) =>
    post<{ user: User }>('/api/auth/register', input).then((r) => r.user),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  joinFamily: (inviteCode: string) =>
    post<{ user: User }>('/api/auth/join', { inviteCode }).then((r) => r.user),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/auth/password', { currentPassword, newPassword }),

  families: () => get<{ families: Family[] }>('/api/families').then((r) => r.families),
  createFamily: (name: string) => post<{ family: Family }>('/api/families', { name }).then((r) => r.family),
  members: (familyId: string) =>
    get<{ members: Member[] }>(`/api/families/${familyId}/members`).then((r) => r.members),
  invites: (familyId: string) =>
    get<{ invites: Invite[] }>(`/api/families/${familyId}/invites`).then((r) => r.invites),
  createInvite: (familyId: string, role: 'parent' | 'sitter') =>
    post<{ invite: Invite }>(`/api/families/${familyId}/invites`, { role }).then((r) => r.invite),
  revokeInvite: (familyId: string, code: string) => del(`/api/families/${familyId}/invites/${code}`),

  children: (familyId: string) =>
    get<{ children: Child[] }>(`/api/families/${familyId}/children`).then((r) => r.children),
  createChild: (familyId: string, input: { name: string; birthdate?: string | null; colour?: string; notes?: string }) =>
    post<{ child: Child }>(`/api/families/${familyId}/children`, input).then((r) => r.child),
  updateChild: (familyId: string, childId: string, input: Partial<Child>) =>
    patch<{ child: Child }>(`/api/families/${familyId}/children/${childId}`, input).then((r) => r.child),

  sessions: (familyId: string) =>
    get<{ sessions: Session[] }>(`/api/families/${familyId}/sessions`).then((r) => r.sessions),
  createSession: (familyId: string, input: { childIds: string[]; startedAt?: string; notes?: string }) =>
    post<{ session: Session }>(`/api/families/${familyId}/sessions`, input).then((r) => r.session),
  session: (sessionId: string) =>
    get<{ session: Session }>(`/api/sessions/${sessionId}`).then((r) => r.session),
  updateSession: (sessionId: string, input: { notes?: string; endedAt?: string | null; childIds?: string[] }) =>
    patch<{ session: Session }>(`/api/sessions/${sessionId}`, input).then((r) => r.session),
  endSession: (sessionId: string, endedAt?: string) =>
    post<{ session: Session }>(`/api/sessions/${sessionId}/end`, { endedAt }).then((r) => r.session),
  deleteSession: (sessionId: string) => del(`/api/sessions/${sessionId}`),

  createEvent: (sessionId: string, input: EventInput) =>
    post<{ event: LogEvent }>(`/api/sessions/${sessionId}/events`, input).then((r) => r.event),
  updateEvent: (eventId: string, input: Partial<EventInput>) =>
    patch<{ event: LogEvent }>(`/api/events/${eventId}`, input).then((r) => r.event),
  stopEvent: (eventId: string, input: { endAt?: string; detail?: Record<string, unknown>; note?: string }) =>
    post<{ event: LogEvent }>(`/api/events/${eventId}/stop`, input).then((r) => r.event),
  deleteEvent: (eventId: string) => del(`/api/events/${eventId}`),

  report: (sessionId: string) => get<{ report: Report }>(`/api/sessions/${sessionId}/report`).then((r) => r.report),
  reportText: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/report.txt`, { credentials: 'same-origin' }).then((r) => r.text()),
};

// --- Report shapes -----------------------------------------------------------

export interface ReportEntry {
  id?: string; at: string; end?: string | null; minutes?: number | null; note?: string;
  [key: string]: unknown;
}

export interface ChildReport {
  child: SessionChild;
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
  session: {
    id: string; date: string; startedAt: string; endedAt: string | null;
    durationMinutes: number | null; notes: string; sitterName: string; familyName: string;
  };
  children: ChildReport[];
  generatedAt: string;
}

// --- Admin -------------------------------------------------------------------

export const admin = {
  overview: () => get<AdminOverview>('/api/admin/overview'),
  users: (q = '') => get<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.users),
  updateUser: (id: string, input: { disabled?: boolean; name?: string }) =>
    patch<{ user: AdminUser }>(`/api/admin/users/${id}`, input).then((r) => r.user),
  resetPassword: (id: string, newPassword: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/password`, { newPassword }),
  deleteUser: (id: string, force = false) =>
    del<{ ok: true }>(`/api/admin/users/${id}${force ? '?force=true' : ''}`),

  families: () => get<{ families: AdminFamily[] }>('/api/admin/families').then((r) => r.families),
  family: (id: string) => get<{ family: AdminFamilyDetail }>(`/api/admin/families/${id}`).then((r) => r.family),
  deleteFamily: (id: string, confirmName: string) =>
    request<{ ok: true }>('DELETE', `/api/admin/families/${id}`, { confirmName }),

  sessions: (familyId?: string) =>
    get<{ sessions: AdminSession[] }>(`/api/admin/sessions${familyId ? `?familyId=${familyId}` : ''}`).then((r) => r.sessions),
  resendReport: (sessionId: string) =>
    post<{ result: SendResult }>(`/api/admin/sessions/${sessionId}/resend-report`).then((r) => r.result),

  emailLog: (status = '') =>
    get<{ entries: EmailLogEntry[] }>(`/api/admin/email-log${status ? `?status=${status}` : ''}`).then((r) => r.entries),
  verifyMail: () => post<{ result: { ok: boolean; error?: string } }>('/api/admin/mail/verify').then((r) => r.result),
  testMail: (to: string) =>
    post<{ result: { ok: boolean; error?: string; skipped?: boolean } }>('/api/admin/mail/test', { to }).then((r) => r.result),

  vacuum: () => post<{ beforeBytes: number; afterBytes: number }>('/api/admin/maintenance/vacuum'),
  backup: () => post<{ path: string; bytes: number }>('/api/admin/maintenance/backup'),
  prune: () => post<{ expiredLogins: number; expiredInvites: number; oldEmailLogs: number }>('/api/admin/maintenance/prune'),
};

export interface AdminOverview {
  counts: {
    users: number; disabled: number; families: number; children: number;
    sessions: number; open: number; events: number; invites: number; logins: number;
  };
  storage: { dbBytes: number; walBytes: number; path: string };
  mail: {
    configured: boolean; host: string; port: number; secure: boolean; from: string;
    authenticated: boolean; adminCount: number;
    recentFailures: { to_email: string; subject: string; error: string; created_at: string }[];
  };
  runtime: { uptimeSeconds: number; node: string; rssBytes: number; now: string };
  activity: { last7Days: { date: string; sessions: number }[] };
}

export interface AdminUser {
  id: string; email: string; name: string; disabled: boolean;
  createdAt: string; lastSeenAt: string | null;
  families: { id: string; name: string; role: string }[];
}

export interface AdminFamily {
  id: string; name: string; createdAt: string;
  members: number; children: number; sessions: number;
}

export interface AdminFamilyDetail {
  id: string; name: string; createdAt: string;
  members: { id: string; name: string; email: string; role: string; disabled: number }[];
  children: { id: string; name: string; colour: string; archived: number }[];
  sessions: { id: string; date: string; startedAt: string; endedAt: string | null; reportSentAt: string | null; events: number }[];
  recipients: { email: string; name: string }[];
}

export interface AdminSession {
  id: string; familyId: string; familyName: string; sitterName: string;
  date: string; startedAt: string; endedAt: string | null;
  reportSentAt: string | null; events: number;
}

export interface EmailLogEntry {
  id: string; sessionId: string | null; to: string; subject: string;
  status: 'sent' | 'failed' | 'skipped'; error: string; createdAt: string;
}

export interface SendResult {
  sent: number; configured?: boolean;
  results: { email: string; ok: boolean; error?: string; skipped?: boolean }[];
}
