import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Building2, Mail, Plus, RefreshCw, CheckCircle2,
  XCircle, LogOut, Search, Trash2, ArrowRight
} from 'lucide-react';
import { api } from '../api';

interface SaasVendorPortalProps {
  user: any;
  logout: () => void;
}

export const SaasVendorPortal: React.FC<SaasVendorPortalProps> = ({ user, logout }) => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    company_name: '',
    admin_name: '',
    email: '',
    username: '',
    plan: 'Enterprise',
    provision_now: true,
    password: '',
  });

  const loadLicensedCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<any[]>('/api/admin/authorized-main-admins');
      setCustomers(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to load companies' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLicensedCompanies();
  }, [loadLicensedCompanies]);

  const handleGrantPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res: any = await api.post('/api/admin/assign-hierarchy', {
        action: 'authorize_main_admin',
        ...form,
      });
      setNotice({
        type: 'success',
        text: `Access granted to ${form.company_name} (${res.email || form.email}).`,
      });
      setForm({
        company_name: '',
        admin_name: '',
        email: '',
        username: '',
        plan: 'Enterprise',
        provision_now: true,
        password: '',
      });
      loadLicensedCompanies();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to grant permission' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleLicenseStatus = async (cust: any) => {
    setNotice(null);
    try {
      const res: any = await api.post('/api/admin/assign-hierarchy', {
        action: 'toggle_main_admin_status',
        email: cust.email,
      });
      setNotice({
        type: 'success',
        text: `${cust.company_name} status updated to ${res.status}.`,
      });
      loadLicensedCompanies();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to update status' });
    }
  };

  const handleDeleteLicense = async (cust: any) => {
    setNotice(null);
    try {
      await api.post('/api/admin/assign-hierarchy', {
        action: 'delete_main_admin',
        email: cust.email,
      });
      setNotice({
        type: 'success',
        text: `Removed ${cust.company_name}.`,
      });
      loadLicensedCompanies();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to remove company' });
    }
  };

  const filteredCustomers = customers.filter(c => {
    if (planFilter !== 'ALL' && c.plan !== planFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      String(c.company_name || '').toLowerCase().includes(q) ||
      String(c.admin_name || '').toLowerCase().includes(q) ||
      String(c.email || '').toLowerCase().includes(q) ||
      String(c.username || '').toLowerCase().includes(q)
    );
  });

  const activeCount = customers.filter(c => c.status === 'Activated').length;
  const pendingCount = customers.filter(c => c.status === 'Authorized').length;
  const revokedCount = customers.filter(c => c.status === 'Revoked').length;

  return (
    <div className="min-h-screen bg-[#060e1e] text-slate-100 flex flex-col">
      {/* Minimal Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#040a17]/90 backdrop-blur-xl px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 p-2 text-white shadow-lg shadow-indigo-500/20">
              <ShieldCheck size={20} />
            </div>
            <div>
              <span className="text-lg font-extrabold tracking-tight text-white">
                MEP <span className="text-sky-400">FieldHub</span>
              </span>
              <p className="text-[11px] text-slate-400">Company Licensing</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-white leading-tight">{user?.name || 'Administrator'}</p>
              <p className="text-[11px] font-mono text-sky-300">{user?.email || 'admin@mepfieldhub.com'}</p>
            </div>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/90 border border-slate-700 hover:border-rose-500 px-3.5 py-2 text-xs font-bold text-slate-200 hover:text-white transition cursor-pointer"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-7 space-y-6">
        {notice && (
          <div
            role="alert"
            className={`rounded-2xl border px-5 py-3.5 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 ${
              notice.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                : 'bg-rose-500/15 border-rose-400/40 text-rose-200'
            }`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {/* Compact KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Companies</span>
            <p className="text-2xl font-extrabold text-white mt-1">{customers.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active</span>
            <p className="text-2xl font-extrabold text-emerald-400 mt-1">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pending</span>
            <p className="text-2xl font-extrabold text-amber-400 mt-1">{pendingCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Suspended</span>
            <p className="text-2xl font-extrabold text-rose-400 mt-1">{revokedCount}</p>
          </div>
        </section>

        {/* Two-Column Workspace */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Grant Access Form */}
          <div className="lg:col-span-5 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="rounded-xl bg-indigo-500/20 border border-indigo-400/30 p-2 text-indigo-300">
                <Plus size={18} />
              </div>
              <h2 className="text-base font-extrabold text-white">Grant Company Permission</h2>
            </div>

            <form onSubmit={handleGrantPermission} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Company Name *</label>
                <input
                  required
                  placeholder="Company name"
                  value={form.company_name}
                  onChange={e => setForm({ ...form, company_name: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Main Admin Email ID *</label>
                <input
                  required
                  type="email"
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white font-mono placeholder:text-slate-500 focus:border-sky-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Main Admin Name *</label>
                  <input
                    required
                    placeholder="Full name"
                    value={form.admin_name}
                    onChange={e => setForm({ ...form, admin_name: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Plan</label>
                  <select
                    value={form.plan}
                    onChange={e => setForm({ ...form, plan: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-sky-400 outline-none"
                  >
                    <option value="Enterprise">Enterprise</option>
                    <option value="Professional">Professional</option>
                    <option value="Starter">Starter</option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.provision_now}
                    onChange={e => setForm({ ...form, provision_now: e.target.checked })}
                    className="rounded border-slate-600"
                  />
                  <span className="text-xs font-semibold text-slate-200">Create login credentials now</span>
                </label>

                {form.provision_now && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      placeholder="Username (optional)"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Password (default: admin123)"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 py-3 px-4 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer disabled:opacity-60"
              >
                <ShieldCheck size={16} />
                {submitting ? 'Granting...' : 'Grant Permission'}
                <ArrowRight size={15} />
              </button>
            </form>
          </div>

          {/* Licensed Companies List */}
          <div className="lg:col-span-7 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                <Building2 size={18} className="text-sky-400" />
                Licensed Companies ({filteredCustomers.length})
              </h2>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    placeholder="Search..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-400"
                  />
                </div>
                <select
                  value={planFilter}
                  onChange={e => setPlanFilter(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="ALL">All Plans</option>
                  <option value="Enterprise">Enterprise</option>
                  <option value="Professional">Professional</option>
                  <option value="Starter">Starter</option>
                </select>
                <button
                  onClick={loadLicensedCompanies}
                  title="Refresh"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs text-slate-400">Loading...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-10 text-center space-y-1.5">
                <Building2 size={28} className="mx-auto text-slate-600" />
                <p className="text-sm font-bold text-slate-300">No companies licensed yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCustomers.map(cust => {
                  const isRevoked = cust.status === 'Revoked';
                  return (
                    <div
                      key={cust.id || cust.email}
                      className="rounded-2xl border border-slate-800 bg-slate-950/75 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-700 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold text-white">{cust.company_name}</span>
                          <span className="rounded-md bg-indigo-500/20 border border-indigo-400/30 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                            {cust.plan || 'Enterprise'}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              isRevoked
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-400/30'
                                : cust.status === 'Activated'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                            }`}
                          >
                            {isRevoked ? <XCircle size={11} /> : <CheckCircle2 size={11} />}
                            {cust.status || 'Authorized'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                          <span className="font-semibold text-sky-300 flex items-center gap-1 font-mono">
                            <Mail size={12} /> {cust.email}
                          </span>
                          <span>{cust.admin_name}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleToggleLicenseStatus(cust)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                            isRevoked
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-400/30'
                              : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-400/30'
                          }`}
                        >
                          {isRevoked ? 'Activate' : 'Suspend'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLicense(cust)}
                          title="Remove"
                          className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-400/25 transition cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
