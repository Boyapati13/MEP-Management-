// ─────────────────────────────────────────────────────────────────────────────
// MEP Management Platform — API Client Utilities
// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE = '';

export function getToken(): string | null {
  return localStorage.getItem('mep_token');
}

export function setToken(token: string) {
  localStorage.setItem('mep_token', token);
}

export function clearToken() {
  localStorage.removeItem('mep_token');
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: any) => request<T>('POST', path, body),
  put: <T>(path: string, body: any) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// Auth
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: any }>('/api/auth/login', { username, password }),
  me: () => api.get<any>('/api/me'),
};

// Sites
export const sitesApi = {
  list: (project_id?: string) => api.get<any[]>(`/api/sites${project_id ? `?project_id=${project_id}` : ''}`),
  get: (id: string) => api.get<any>(`/api/sites/${id}`),
  create: (data: any) => api.post<any>('/api/sites', data),
  update: (id: string, data: any) => api.put<any>(`/api/sites/${id}`, data),
  control: (id: string) => api.get<any>(`/api/sites/${id}/control`),
};

// Workers
export const workersApi = {
  list: (params?: Record<string, string>) => api.get<any[]>(`/api/workers${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  get: (id: string) => api.get<any>(`/api/workers/${id}`),
  profile: (id: string) => api.get<any>(`/api/workers/${id}/profile`),
  create: (data: any) => api.post<any>('/api/workers', data),
  update: (id: string, data: any) => api.put<any>(`/api/workers/${id}`, data),
};

// Workforce
export const workforceApi = {
  today: (params?: Record<string, string>) => api.get<any>(`/api/workforce/today${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  calendar: (params: Record<string, string>) => api.get<any>(`/api/workforce/calendar?${new URLSearchParams(params).toString()}`),
};

// Attendance
export const attendanceApi = {
  list: (project_id?: string) => api.get<any[]>(`/api/attendance${project_id ? `?project_id=${project_id}` : ''}`),
  punchIn: (data: any) => api.post<any>('/api/attendance/gps-punch-in', data),
  punchOut: (data: any) => api.post<any>('/api/attendance/gps-punch-out', data),
  exceptions: (params?: Record<string, string>) => api.get<any[]>(`/api/attendance/exceptions${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  approveOT: (id: string, action: string) => api.post<any>(`/api/attendance/${id}/overtime-approve`, { action }),
  adjust: (id: string, data: any) => api.post<any>(`/api/attendance/${id}/adjust`, data),
  approveAdjustment: (id: string, action: string, reject_reason?: string) =>
    api.post<any>(`/api/attendance_adjustments/${id}/approve`, { action, reject_reason }),
};

// Site Instructions
export const instructionsApi = {
  list: (params?: Record<string, string>) => api.get<any[]>(`/api/site_instructions${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  get: (id: string) => api.get<any>(`/api/site_instructions/${id}`),
  create: (data: any) => api.post<any>('/api/site_instructions', data),
  update: (id: string, data: any) => api.put<any>(`/api/site_instructions/${id}`, data),
  assign: (id: string, data: any) => api.post<any>(`/api/site_instructions/${id}/assign`, data),
  acknowledge: (id: string, comment?: string) => api.post<any>(`/api/site_instructions/${id}/acknowledge`, { comment }),
  start: (id: string, comment?: string) => api.post<any>(`/api/site_instructions/${id}/start`, { comment }),
  submitEvidence: (id: string, data: any) => api.post<any>(`/api/site_instructions/${id}/evidence`, data),
  verify: (id: string, action: string, comment?: string) => api.post<any>(`/api/site_instructions/${id}/verify`, { action, comment }),
  close: (id: string, comment?: string) => api.post<any>(`/api/site_instructions/${id}/close`, { comment }),
  updates: (id: string) => api.get<any[]>(`/api/site_instructions/${id}/updates`),
  addUpdate: (id: string, content: string, update_type?: string) =>
    api.post<any>(`/api/site_instructions/${id}/updates`, { content, update_type }),
};

// Leave
export const leaveApi = {
  types: () => api.get<any[]>('/api/leave_types'),
  list: (params?: Record<string, string>) => api.get<any[]>(`/api/leave_requests${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  get: (id: string) => api.get<any>(`/api/leave_requests/${id}`),
  submit: (data: any) => api.post<any>('/api/leave_requests', data),
  approve: (id: string) => api.post<any>(`/api/leave_requests/${id}/approve`, {}),
  reject: (id: string, reject_reason: string) => api.post<any>(`/api/leave_requests/${id}/reject`, { reject_reason }),
  balances: (params?: Record<string, string>) => api.get<any[]>(`/api/leave_balances${params ? '?' + new URLSearchParams(params).toString() : ''}`),
};

// Shifts
export const shiftsApi = {
  list: (project_id?: string) => api.get<any[]>(`/api/shift_templates${project_id ? `?project_id=${project_id}` : ''}`),
  create: (data: any) => api.post<any>('/api/shift_templates', data),
  update: (id: string, data: any) => api.put<any>(`/api/shift_templates/${id}`, data),
};

// Payroll
export const payrollApi = {
  profiles: () => api.get<any[]>('/api/payroll_profiles'),
  createProfile: (data: any) => api.post<any>('/api/payroll_profiles', data),
  updateProfile: (id: string, data: any) => api.put<any>(`/api/payroll_profiles/${id}`, data),
  periods: (project_id?: string) => api.get<any[]>(`/api/payroll_periods${project_id ? `?project_id=${project_id}` : ''}`),
  getPeriod: (id: string) => api.get<any>(`/api/payroll_periods/${id}`),
  createPeriod: (data: any) => api.post<any>('/api/payroll_periods', data),
  compute: (id: string) => api.post<any>(`/api/payroll_periods/${id}/compute`, {}),
  lock: (id: string) => api.post<any>(`/api/payroll_periods/${id}/lock`, {}),
  addAdjustment: (data: any) => api.post<any>('/api/payroll_adjustments', data),
};

// Reports
export const reportsApi = {
  workforceDaily: (params: Record<string, string>) =>
    api.get<any>(`/api/reports/workforce/daily?${new URLSearchParams(params).toString()}`),
  payrollHours: (params: Record<string, string>) =>
    api.get<any>(`/api/reports/workforce/payroll-hours?${new URLSearchParams(params).toString()}`),
};

// Projects
export const projectsApi = {
  list: () => api.get<any[]>('/api/projects'),
};
