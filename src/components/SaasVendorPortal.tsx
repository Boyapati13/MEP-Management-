import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Building2, Mail, Plus, RefreshCw, Lock, CheckCircle2,
  XCircle, KeyRound, LogOut, Sparkles, Search, Trash2, Shield, Users, ArrowRight
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
    notes: 'Licensed Customer Company — Main Admin Email ID granted permission by Our Company (ERP & SaaS Provider).',
  });

  const loadLicensedCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<any[]>('/api/admin/authorized-main-admins');
      setCustomers(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to load licensed customer companies' });
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
        text: `Permission granted to "${form.company_name}"! Main Admin Email ID "${res.email || form.email}" (${form.admin_name}) is now ${
          form.provision_now ? 'activated and ready to sign in' : 'authorized to activate on the login page'
        } to manage their own private projects, drawings, employees, clients, and subcontractors.`,
      });
      setForm({
        company_name: '',
        admin_name: '',
        email: '',
        username: '',
        plan: 'Enterprise',
        provision_now: true,
        password: '',
        notes: 'Licensed Customer Company — Main Admin Email ID granted permission by Our Company (ERP & SaaS Provider).',
      });
      loadLicensedCompanies();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to grant customer company permission' });
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
        text: `License for "${cust.company_name}" (${cust.email}) updated to ${res.status}.`,
      });
      loadLicensedCompanies();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to update license status' });
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
        text: `Removed license entry for "${cust.company_name}" (${cust.email}).`,
      });
      loadLicensedCompanies();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to remove license entry' });
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
      {/* Top SaaS Provider Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#040a17]/90 backdrop-blur-xl px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 p-2.5 text-white shadow-lg shadow-indigo-500/20">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold tracking-tight text-white">
                  MEP <span className="text-sky-400">FieldHub</span>
                </span>
                <span className="rounded-md bg-indigo-500/20 border border-indigo-400/35 px-2 py-0.5 text-[10px] font-mono font-bold text-indigo-300 uppercase">
                  Tier 1 · ERP &amp; SaaS Vendor Console
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Customer Company Licensing &amp; Main Admin Email ID Permission Portal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-400/30 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              <Lock size={12} /> Strict Tenant Privacy: Customer Projects &amp; Data Hidden
            </div>
            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-800">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-white leading-tight">{user?.name || 'Platform Owner'}</p>
                <p className="text-[10px] font-mono text-sky-300">{user?.email || 'admin@mepfieldhub.com'}</p>
              </div>
              <button
                onClick={logout}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/90 border border-slate-700 hover:border-rose-500 px-3.5 py-2 text-xs font-bold text-slate-200 hover:text-white transition cursor-pointer"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 space-y-8">
        {/* Hero Architecture & Privacy Banner */}
        <section className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-slate-900 via-indigo-950/80 to-slate-900 p-6 sm:p-8 shadow-2xl">
          <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-sky-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />

          <div className="relative space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-400/10 border border-sky-400/30 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-sky-300">
                <Sparkles size={13} className="text-amber-300" /> Our Company · ERP &amp; SaaS Licensing Control Plane
              </div>
              <button
                onClick={loadLicensedCompanies}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition cursor-pointer"
              >
                <RefreshCw size={13} /> Refresh Licenses
              </button>
            </div>

            <div className="max-w-3xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                Grant Main Admin Permission to Companies That Bought Our Software
              </h1>
              <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                As the <strong>ERP &amp; SaaS Provider</strong>, we do not view or access customer projects, drawings, submittals, or site data. Use this portal solely to authorize the <strong>Main Admin Email ID</strong> of each company that purchased a software license.
              </p>
            </div>

            {/* 3-Tier Visual Separation Flow */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="rounded-2xl bg-indigo-500/15 border border-indigo-400/40 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-300">Tier 1 · You Are Here</span>
                  <Shield size={15} className="text-indigo-300" />
                </div>
                <p className="text-sm font-bold text-white">Our Company (ERP / SaaS Vendor)</p>
                <p className="text-xs text-slate-300 mt-1">
                  Grants Main Admin permission to the buyer company&apos;s Email ID. <strong>Zero access to customer projects or data.</strong>
                </p>
              </div>

              <div className="rounded-2xl bg-sky-500/10 border border-sky-400/30 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-sky-300">Tier 2 · Customer Buyer</span>
                  <KeyRound size={15} className="text-sky-300" />
                </div>
                <p className="text-sm font-bold text-white">Customer Company Main Admin</p>
                <p className="text-xs text-slate-300 mt-1">
                  Signs in with their authorized Email ID, creates their own MEP Projects, Drawings &amp; Submittals, and manages their company.
                </p>
              </div>

              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/30 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-300">Tier 3 · Customer&apos;s Users</span>
                  <Users size={15} className="text-emerald-300" />
                </div>
                <p className="text-sm font-bold text-white">Employees, Clients &amp; Subcontractors</p>
                <p className="text-xs text-slate-300 mt-1">
                  Created by the Customer&apos;s Main Admin for their own PMs, Site Supervisors, Employers/Clients, and Subcontractors.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Status Notice */}
        {notice && (
          <div
            role="alert"
            className={`rounded-2xl border px-5 py-4 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 ${
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

        {/* KPI Row */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Licensed Companies</span>
            <p className="text-3xl font-extrabold text-white mt-1">{customers.length}</p>
            <span className="text-xs text-sky-400 mt-1 block">Total customer organizations</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Activated Main Admins</span>
            <p className="text-3xl font-extrabold text-emerald-400 mt-1">{activeCount}</p>
            <span className="text-xs text-slate-400 mt-1 block">Signed in &amp; running ERP</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pre-Authorized Emails</span>
            <p className="text-3xl font-extrabold text-amber-400 mt-1">{pendingCount}</p>
            <span className="text-xs text-slate-400 mt-1 block">Awaiting customer activation</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Suspended / Revoked</span>
            <p className="text-3xl font-extrabold text-rose-400 mt-1">{revokedCount}</p>
            <span className="text-xs text-slate-400 mt-1 block">Access currently blocked</span>
          </div>
        </section>

        {/* Two-Column Layout: Left = Grant Permission Form | Right = Licensed Companies Table */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (5 cols): Grant Permission to Customer Company */}
          <div className="lg:col-span-5 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="rounded-xl bg-indigo-500/20 border border-indigo-400/30 p-2 text-indigo-300">
                <Plus size={18} />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-white">Grant Permission to Customer Company</h2>
                <p className="text-xs text-slate-400">Authorize the Main Admin Email ID of a company that bought our software</p>
              </div>
            </div>

            <form onSubmit={handleGrantPermission} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Customer Company Name (Buyer) *
                </label>
                <input
                  required
                  placeholder="e.g. Apex MEP Contracting Ltd"
                  value={form.company_name}
                  onChange={e => setForm({ ...form, company_name: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Customer Main Admin Email ID *
                </label>
                <input
                  required
                  type="email"
                  placeholder="e.g. director@apexmep.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white font-mono placeholder:text-slate-500 focus:border-sky-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Main Admin Full Name *
                  </label>
                  <input
                    required
                    placeholder="e.g. Roberto Borg"
                    value={form.admin_name}
                    onChange={e => setForm({ ...form, admin_name: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Subscription Plan Tier
                  </label>
                  <select
                    value={form.plan}
                    onChange={e => setForm({ ...form, plan: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-sky-400 outline-none"
                  >
                    <option value="Enterprise">Enterprise (Unlimited)</option>
                    <option value="Professional">Professional (25 Projects)</option>
                    <option value="Starter">Starter (5 Projects)</option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.provision_now}
                    onChange={e => setForm({ ...form, provision_now: e.target.checked })}
                    className="mt-0.5 rounded border-slate-600"
                  />
                  <span className="text-xs text-slate-300 leading-relaxed">
                    <strong>Create active login credentials immediately</strong> (if unchecked, the customer Main Admin will click <em>&ldquo;Activate Main Admin&rdquo;</em> on the login page to verify their Email ID and choose their own password).
                  </span>
                </label>

                {form.provision_now && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Optional Username</label>
                      <input
                        placeholder="Auto from Email ID"
                        value={form.username}
                        onChange={e => setForm({ ...form, username: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Initial Password</label>
                      <input
                        type="text"
                        placeholder="Default: admin123"
                        value={form.password}
                        onChange={e => setForm({ ...form, password: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 py-3 px-4 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer disabled:opacity-60"
              >
                <ShieldCheck size={16} />
                {submitting ? 'Granting Permission...' : 'Grant Main Admin Permission to Company'}
                <ArrowRight size={15} />
              </button>
            </form>
          </div>

          {/* Right Column (7 cols): Licensed Customer Companies Register */}
          <div className="lg:col-span-7 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                  <Building2 size={18} className="text-sky-400" />
                  Licensed Customer Companies ({filteredCustomers.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Companies authorized to use MEP FieldHub ERP under their own Main Admin Email ID
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    placeholder="Search company or email..."
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
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center text-xs text-slate-400">Loading licensed customer companies...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-10 text-center space-y-2">
                <Building2 size={32} className="mx-auto text-slate-600" />
                <p className="text-sm font-bold text-slate-300">No Customer Companies Licensed Yet</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Use the form on the left to grant Main Admin permission to the first company that bought your software. Once authorized, they can sign in with their Email ID and manage their own projects and users.
                </p>
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
                            {cust.plan || 'Enterprise'} Plan
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
                          <span>Main Admin: <strong>{cust.admin_name}</strong></span>
                          {cust.username && (
                            <span className="text-slate-400 font-mono text-[11px]">(@{cust.username})</span>
                          )}
                        </div>

                        <p className="text-[11px] text-slate-500">
                          Granted: {cust.created_at ? String(cust.created_at).slice(0, 10) : '—'}
                          {' · '}
                          Tenant Data Scope: <span className="text-emerald-400 font-semibold">Private &amp; Isolated to {cust.company_name}</span>
                        </p>
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
                          {isRevoked ? 'Reactivate License' : 'Suspend / Revoke'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLicense(cust)}
                          title="Remove License"
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
