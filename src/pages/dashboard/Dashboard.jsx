import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import {
  LayoutDashboard,
  CalendarDays,
  Scissors,
  Users,
  DollarSign,
  TrendingUp,
  Percent,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  Edit2,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Search,
  Filter,
  LogOut,
  AlertCircle,
  RefreshCw,
  Building,
  UserCheck,
  Sparkles,
  ChevronRight,
  ArrowRight,
  Globe,
  MapPin,
  Phone,
  Briefcase,
  Layers,
} from 'lucide-react';

const BUSINESS_CATEGORIES = [
  'Salon & Beauty Parlour',
  'Spa & Massage Therapy',
  'Healthcare & Dental Clinic',
  'Fitness, Gym & Yoga',
  'Legal & CA / Financial Consulting',
  'Tuition, Coaching & Mentorship',
  'Photography & Creative Studio',
  'Automobile & Bike Detailing',
  'Other Professional Services',
];

const TEAM_SIZES = [
  'Solo Specialist (Just Me)',
  'Small Boutique Team (2 - 5 Specialists)',
  'Medium Studio / Clinic (6 - 15 Staff)',
  'Multi-Branch Enterprise (15+ Staff)',
];

export default function Dashboard() {
  const navigate = useNavigate();

  // Navigation tab
  const [activeTab, setActiveTab] = useState('overview');

  // Core user & business state
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [businessMeta, setBusinessMeta] = useState({
    location: '',
    category: '',
    teamSize: 'Solo Specialist (Just Me)',
    appointmentMode: 'In-person at our venue',
  });
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  // Onboarding state if user has no business yet
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({
    name: '',
    slug: '',
    location: '',
    category: 'Salon & Beauty Parlour',
    phone: '',
    teamSize: 'Solo Specialist (Just Me)',
    appointmentMode: 'In-person at our venue',
    timezone: () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      } catch {
        return 'Asia/Kolkata';
      }
    },
  });
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState(null);

  // Tab 1: Overview stats
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Tab 2: Calendar / Bookings
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingFilter, setBookingFilter] = useState('all');

  // Tab 3: Services
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);

  // Tab 4: Clients
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [searchClient, setSearchClient] = useState('');

  // Notifications
  const [feedback, setFeedback] = useState(null);

  const showToast = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadBusinessMeta = (bizId) => {
    try {
      const saved = localStorage.getItem(`bookly_meta_${bizId}`);
      if (saved) {
        setBusinessMeta(JSON.parse(saved));
      }
    } catch {
      // fallback
    }
  };

  const saveBusinessMeta = (bizId, meta) => {
    try {
      localStorage.setItem(`bookly_meta_${bizId}`, JSON.stringify(meta));
      setBusinessMeta(meta);
    } catch (e) {
      console.warn('Could not persist extra metadata:', e);
    }
  };

  const fetchUserBusiness = async (userId, token) => {
    try {
      const { data: b1 } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_user_id', userId)
        .maybeSingle();

      if (b1) return b1;

      const { data: mem } = await supabase
        .from('business_members')
        .select('business_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (mem?.business_id) {
        const { data: b2 } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', mem.business_id)
          .maybeSingle();
        if (b2) return b2;
      }

      const { data: b3 } = await supabase
        .from('businesses')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (b3) return b3;

      if (token) {
        const apiMe = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()).catch(() => ({}));

        if (apiMe.data?.business) return apiMe.data.business;
      }
    } catch (err) {
      console.warn('Business lookup error:', err);
    }
    return null;
  };

  useEffect(() => {
    async function initAuth() {
      setLoading(true);
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
          navigate('/login');
          return;
        }

        setUser(session.user);

        const biz = await fetchUserBusiness(session.user.id, session.access_token);

        if (biz) {
          setBusiness(biz);
          loadBusinessMeta(biz.id);
          setNeedsOnboarding(false);
        } else {
          setNeedsOnboarding(true);
        }
      } catch (err) {
        console.error('Failed to initialize dashboard:', err);
      } finally {
        setLoading(false);
      }
    }

    initAuth();
  }, [navigate]);

  const handleCreateBusiness = async (e) => {
    e.preventDefault();
    if (!onboardingForm.name.trim() || !onboardingForm.slug.trim()) {
      setOnboardingError('Please enter a business name and booking URL slug.');
      return;
    }
    if (!onboardingForm.location.trim()) {
      setOnboardingError('Please enter your business location (city or area).');
      return;
    }

    setOnboardingLoading(true);
    setOnboardingError(null);

    const timezoneStr = typeof onboardingForm.timezone === 'function' ? onboardingForm.timezone() : onboardingForm.timezone;

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('create_business', {
        p_name: onboardingForm.name.trim(),
        p_slug: onboardingForm.slug.trim().toLowerCase(),
        p_timezone: timezoneStr,
      });

      if (rpcErr && rpcErr.message !== 'already_has_business') {
        const session = (await supabase.auth.getSession()).data.session;
        const apiRes = await fetch('/api/onboarding', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            name: onboardingForm.name.trim(),
            slug: onboardingForm.slug.trim().toLowerCase(),
            timezone: timezoneStr,
          }),
        });

        if (!apiRes.ok) {
          const apiJson = await apiRes.json().catch(() => ({}));
          throw new Error(apiJson.error?.message || rpcErr.message);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      let createdBiz = null;
      if (session) {
        createdBiz = await fetchUserBusiness(session.user.id, session.access_token);
      }

      const resolvedBizId = createdBiz?.id || (typeof rpcRes === 'string' ? rpcRes : 'new-business');

      if (onboardingForm.phone.trim() && resolvedBizId) {
        try {
          await supabase
            .from('businesses')
            .update({ phone: onboardingForm.phone.trim() })
            .eq('id', resolvedBizId);
        } catch (phoneErr) {
          console.warn('Could not update business phone:', phoneErr);
        }
      }

      const metaToSave = {
        location: onboardingForm.location.trim(),
        category: onboardingForm.category,
        teamSize: onboardingForm.teamSize,
        appointmentMode: onboardingForm.appointmentMode,
      };
      saveBusinessMeta(resolvedBizId, metaToSave);

      if (createdBiz) {
        setBusiness(createdBiz);
      } else {
        const optimisticBiz = {
          id: resolvedBizId,
          owner_user_id: user?.id || '',
          name: onboardingForm.name.trim(),
          slug: onboardingForm.slug.trim().toLowerCase(),
          timezone: timezoneStr,
          phone: onboardingForm.phone.trim() || null,
          status: 'active',
          created_at: new Date().toISOString(),
        };
        setBusiness(optimisticBiz);
      }

      setNeedsOnboarding(false);
      showToast('success', 'Business setup complete! Welcome to Bookly.');
    } catch (err) {
      console.error('Onboarding failed:', err);
      setOnboardingError(err.message || 'Failed to setup business. Please check details and try again.');
    } finally {
      setOnboardingLoading(false);
    }
  };

  const loadSummary = useCallback(async (bid) => {
    setLoadingSummary(true);
    try {
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const { data, error } = await supabase.rpc('dashboard_summary', {
        p_business: bid,
        p_day_start: dayStart,
        p_day_end: dayEnd,
      });

      if (!error && data) {
        setSummary(data);
      } else {
        const session = (await supabase.auth.getSession()).data.session;
        const fallbackRes = await fetch('/api/dashboard/summary', {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        }).then((r) => r.json()).catch(() => ({}));

        if (fallbackRes.data) {
          setSummary(fallbackRes.data);
        } else {
          const [bookingsRes, clientsRes] = await Promise.all([
            supabase.from('bookings').select('price_cents,status,starts_at').eq('business_id', bid),
            supabase.from('clients').select('id', { count: 'exact' }).eq('business_id', bid),
          ]);

          const allBookings = bookingsRes.data || [];
          const todayCount = allBookings.filter(
            (b) => b.starts_at >= dayStart && b.starts_at < dayEnd
          ).length;
          const upcomingCount = allBookings.filter(
            (b) => new Date(b.starts_at).getTime() > Date.now() && ['pending', 'confirmed'].includes(b.status)
          ).length;
          const revenue = allBookings
            .filter((b) => ['confirmed', 'completed'].includes(b.status))
            .reduce((sum, b) => sum + (b.price_cents || 0), 0);
          const noShows = allBookings.filter((b) => b.status === 'no_show').length;
          const completed = allBookings.filter((b) => b.status === 'completed').length;
          const totalValid = completed + noShows;
          const noShowRate = totalValid > 0 ? Math.round((noShows / totalValid) * 100 * 10) / 10 : 0;

          setSummary({
            today: todayCount,
            upcoming: upcomingCount,
            revenue_cents: revenue,
            clients: clientsRes.count || 0,
            no_show_rate: noShowRate,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load overview summary:', err);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const loadBookings = useCallback(async (bid) => {
    setLoadingBookings(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          business_id,
          service_id,
          provider_id,
          client_id,
          starts_at,
          ends_at,
          status,
          price_cents,
          notes,
          created_at,
          service:services(name, duration_minutes),
          provider:providers(name),
          client:clients(name, email, phone)
        `)
        .eq('business_id', bid)
        .order('starts_at', { ascending: false });

      if (!error && data) {
        setBookings(data);
      } else {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`/api/bookings?from=${new Date(Date.now() - 30 * 864e5).toISOString()}&to=${new Date(Date.now() + 60 * 864e5).toISOString()}`, {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        }).then((r) => r.json()).catch(() => ({}));

        if (res.data?.items) {
          setBookings(res.data.items);
        }
      }
    } catch (err) {
      console.error('Failed to load bookings:', err);
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  const loadServices = useCallback(async (bid) => {
    setLoadingServices(true);
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('business_id', bid)
        .order('name');

      if (!error && data) {
        setServices(data);
      }
    } catch (err) {
      console.error('Failed to load services:', err);
    } finally {
      setLoadingServices(false);
    }
  }, []);

  const loadClients = useCallback(async (bid) => {
    setLoadingClients(true);
    try {
      const { data, error } = await supabase
        .from('client_stats')
        .select('*')
        .eq('business_id', bid)
        .order('name');

      if (!error && data) {
        setClients(data);
      } else {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch('/api/clients', {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        }).then((r) => r.json()).catch(() => ({}));

        if (res.data?.items) {
          setClients(res.data.items);
        }
      }
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoadingClients(false);
    }
  }, []);

  useEffect(() => {
    if (!business) return;

    if (activeTab === 'overview') loadSummary(business.id);
    if (activeTab === 'calendar') loadBookings(business.id);
    if (activeTab === 'services') loadServices(business.id);
    if (activeTab === 'clients') loadClients(business.id);
  }, [business, activeTab, loadSummary, loadBookings, loadServices, loadClients]);

  const handleUpdateStatus = async (bookingId, newStatus) => {
    if (!business) return;

    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: newStatus })
        .eq('id', bookingId)
        .eq('business_id', business.id);

      if (error) {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`/api/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!res.ok) throw new Error('Could not update status');
      }

      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: newStatus } : b))
      );
      showToast('success', `Appointment status updated to "${newStatus}".`);
      loadSummary(business.id);
    } catch (err) {
      console.error('Status update failed:', err);
      showToast('error', err.message || 'Failed to change appointment status.');
    }
  };

  const handleSaveService = async (e) => {
    e.preventDefault();
    if (!business || !editingService) return;

    const { id, name, description, duration_minutes, price_cents, active } = editingService;

    if (!name?.trim()) {
      showToast('error', 'Service name is required');
      return;
    }

    try {
      if (id) {
        const { error } = await supabase
          .from('services')
          .update({
            name: name.trim(),
            description: description?.trim() || null,
            duration_minutes: Number(duration_minutes),
            price_cents: Number(price_cents),
            active: active ?? true,
          })
          .eq('id', id)
          .eq('business_id', business.id);

        if (error) throw error;
        showToast('success', 'Service updated successfully');
      } else {
        const { error } = await supabase.from('services').insert({
          business_id: business.id,
          name: name.trim(),
          description: description?.trim() || null,
          duration_minutes: Number(duration_minutes) || 30,
          price_cents: Number(price_cents) || 50000,
          active: active ?? true,
        });

        if (error) throw error;
        showToast('success', 'New service added successfully');
      }

      setIsServiceModalOpen(false);
      setEditingService(null);
      loadServices(business.id);
    } catch (err) {
      console.error('Service save failed:', err);
      showToast('error', err.message || 'Could not save service.');
    }
  };

  const handleToggleServiceActive = async (service) => {
    if (!business) return;
    try {
      const { error } = await supabase
        .from('services')
        .update({ active: !service.active })
        .eq('id', service.id)
        .eq('business_id', business.id);

      if (error) throw error;

      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, active: !s.active } : s))
      );
      showToast('success', `Service ${service.active ? 'disabled' : 'enabled'}.`);
    } catch (err) {
      showToast('error', err.message || 'Failed to update service status');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const handleCopyLink = () => {
    if (!business) return;
    const bookingUrl = `${window.location.origin}/booking/${business.slug}`;
    navigator.clipboard.writeText(bookingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const formatRupees = (cents = 0) => {
    const rupees = Math.round(cents / 100);
    return `₹${rupees.toLocaleString('en-IN')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // Multi-question Onboarding wizard
  if (needsOnboarding || !business) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-lg text-center px-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-200 mb-3">
            <Building className="w-6 h-6" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Tell Us About Your Business
          </h2>
          <p className="mt-1.5 text-sm text-slate-600">
            Let's customize Bookly for <span className="font-semibold text-slate-800">{user?.email}</span>.
          </p>
        </div>

        <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg px-4">
          <div className="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200 sm:px-10">
            {onboardingError && (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                <div className="leading-relaxed">{onboardingError}</div>
              </div>
            )}

            <form onSubmit={handleCreateBusiness} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  1. Business Name *
                </label>
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    required
                    type="text"
                    placeholder="e.g. Aura Wellness Spa or Apex Dental"
                    value={onboardingForm.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      const slugified = val
                        .toLowerCase()
                        .trim()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-+|-+$/g, '')
                        .slice(0, 38);
                      setOnboardingForm({ ...onboardingForm, name: val, slug: slugified });
                    }}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  2. Booking Link URL *
                </label>
                <div className="flex rounded-xl border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                  <span className="bg-slate-50 px-3 py-2.5 text-slate-500 text-xs flex items-center border-r border-slate-200 font-mono">
                    /booking/
                  </span>
                  <input
                    required
                    type="text"
                    placeholder="aura-wellness"
                    value={onboardingForm.slug}
                    onChange={(e) =>
                      setOnboardingForm({
                        ...onboardingForm,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 38),
                      })
                    }
                    className="w-full px-3 py-2.5 focus:outline-none text-slate-800 text-sm font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  3. Business Location / City *
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    required
                    type="text"
                    placeholder="e.g. Indiranagar, Bengaluru, Karnataka"
                    value={onboardingForm.location}
                    onChange={(e) => setOnboardingForm({ ...onboardingForm, location: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Displayed on your booking page so clients know where to visit.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  4. Business Category
                </label>
                <div className="relative">
                  <Briefcase className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <select
                    value={onboardingForm.category}
                    onChange={(e) => setOnboardingForm({ ...onboardingForm, category: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium bg-white"
                  >
                    {BUSINESS_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  5. Contact Phone / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={onboardingForm.phone}
                    onChange={(e) => setOnboardingForm({ ...onboardingForm, phone: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  6. Team Size / Specialists
                </label>
                <div className="relative">
                  <Users className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <select
                    value={onboardingForm.teamSize}
                    onChange={(e) => setOnboardingForm({ ...onboardingForm, teamSize: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium bg-white"
                  >
                    {TEAM_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={onboardingLoading}
                  className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition flex items-center justify-center gap-2 text-sm"
                >
                  {onboardingLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Complete Setup & Launch Dashboard</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
              <span>Logged in as {user?.email}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-rose-600 hover:text-rose-700 font-semibold"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* Toast Feedback */}
      {feedback && (
        <div className="fixed bottom-5 right-5 z-50 animate-bounce">
          <div
            className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-medium flex items-center gap-2.5 ${
              feedback.type === 'success'
                ? 'bg-emerald-900 text-emerald-100 border-emerald-700'
                : 'bg-rose-900 text-rose-100 border-rose-700'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span>{feedback.message}</span>
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-white border-r border-slate-200 shrink-0 flex flex-col justify-between">
        <div>
          {/* Logo */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-100">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xl font-black text-slate-900">
                  Book<span className="text-indigo-600">ly</span>
                </span>
                <span className="block text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">
                  Pro Portal
                </span>
              </div>
            </div>
          </div>

          {/* Business Info snippet with Location */}
          {business && (
            <div className="p-4 mx-4 my-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2">
              <div>
                <p className="text-xs font-bold text-slate-900 truncate">{business.name}</p>
                {businessMeta.location && (
                  <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin className="w-3 h-3 text-indigo-600 shrink-0" />
                    <span>{businessMeta.location}</span>
                  </p>
                )}
                {businessMeta.category && (
                  <p className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-1">
                    {businessMeta.category}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                <a
                  href={`/booking/${business.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> View Page
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1"
                >
                  {copiedLink ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  {copiedLink ? 'Copied' : 'Share'}
                </button>
              </div>
            </div>
          )}

          {/* Nav Links */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'overview'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" /> Overview
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'calendar'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CalendarDays className="w-4 h-4" /> Calendar
            </button>
            <button
              onClick={() => setActiveTab('services')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'services'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Scissors className="w-4 h-4" /> Services
            </button>
            <button
              onClick={() => setActiveTab('clients')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'clients'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4" /> Clients
            </button>
          </nav>
        </div>

        {/* User Profile & Logout */}
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-xs font-semibold text-slate-800 truncate">{user?.email}</p>
              <p className="text-[11px] text-slate-400 capitalize">{business?.status || 'Active'}</p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign Out"
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 sm:p-10 max-w-7xl mx-auto w-full overflow-y-auto">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Business Overview</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {business?.name}{businessMeta.location ? ` • ${businessMeta.location}` : ''} • Real-time performance & appointments
                </p>
              </div>

              {business && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyLink}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition shadow-xs"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedLink ? 'Link Copied!' : 'Copy Booking Link'}
                  </button>
                  <a
                    href={`/booking/${business.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white transition shadow-sm"
                  >
                    Public Page <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>

            {/* Metric KPI Cards with Rupees (₹) */}
            {loadingSummary ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-32 bg-white rounded-3xl border border-slate-200 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* 1. Today's Bookings */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today's Bookings</span>
                    <h3 className="text-3xl font-black text-slate-900 mt-2">{summary?.today ?? 0}</h3>
                    <p className="text-xs text-slate-400 mt-1">{summary?.upcoming ?? 0} upcoming ahead</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <CalendarDays className="w-6 h-6" />
                  </div>
                </div>

                {/* 2. Total Revenue (in Rupees ₹) */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Revenue</span>
                    <h3 className="text-3xl font-black text-slate-900 mt-2">
                      {formatRupees(summary?.revenue_cents ?? 0)}
                    </h3>
                    <p className="text-xs text-emerald-600 font-medium mt-1">Confirmed & Completed (INR)</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-2xl">
                    ₹
                  </div>
                </div>

                {/* 3. Total Clients */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Clients</span>
                    <h3 className="text-3xl font-black text-slate-900 mt-2">{summary?.clients ?? 0}</h3>
                    <p className="text-xs text-slate-400 mt-1">Unique client records</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
                    <Users className="w-6 h-6" />
                  </div>
                </div>

                {/* 4. No-Show Rate */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">No-Show Rate</span>
                    <h3 className="text-3xl font-black text-slate-900 mt-2">{summary?.no_show_rate ?? 0}%</h3>
                    <p className="text-xs text-slate-400 mt-1">no-show ÷ completed</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                    <Percent className="w-6 h-6" />
                  </div>
                </div>
              </div>
            )}

            {/* Quick Action Shortcuts */}
            <div className="bg-gradient-to-r from-indigo-900 to-slate-900 rounded-3xl p-8 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="max-w-xl">
                <span className="px-3 py-1 rounded-full bg-indigo-500/30 text-indigo-200 text-xs font-bold uppercase tracking-wide">
                  Business Setup Complete
                </span>
                <h3 className="text-2xl font-bold mt-3">Ready to accept online bookings?</h3>
                <p className="text-slate-300 text-sm mt-1 leading-relaxed">
                  Share your customized booking link with customers in {businessMeta.location || 'your city'}. Add your services and start scheduling appointments!
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setActiveTab('calendar')}
                  className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition"
                >
                  View Calendar
                </button>
                <button
                  onClick={() => setActiveTab('services')}
                  className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-xs shadow-md transition"
                >
                  Manage Services (₹)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CALENDAR & APPOINTMENTS */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Calendar & Appointments</h1>
                <p className="text-sm text-slate-500 mt-0.5">Manage live bookings and update appointment states.</p>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex p-1 bg-white border border-slate-200 rounded-xl">
                {['all', 'confirmed', 'completed', 'cancelled'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setBookingFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                      bookingFilter === f ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {loadingBookings ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {bookings
                  .filter((b) => (bookingFilter === 'all' ? true : b.status === bookingFilter))
                  .map((b) => {
                    const statusColors = {
                      confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      completed: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                      cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
                      pending: 'bg-amber-50 text-amber-700 border-amber-200',
                      no_show: 'bg-slate-100 text-slate-700 border-slate-200',
                    };

                    return (
                      <div
                        key={b.id}
                        className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        {/* Time & Service */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2.5">
                            <span className="font-bold text-slate-900 text-base">
                              {new Date(b.starts_at).toLocaleDateString([], {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}{' '}
                              • {new Date(b.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                                statusColors[b.status] || 'bg-slate-50 text-slate-600'
                              }`}
                            >
                              {b.status}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-700">
                            {b.service?.name || 'Standard Service'}
                            <span className="text-xs font-normal text-slate-400">
                              {' '}
                              ({b.service?.duration_minutes || 30} mins) • {formatRupees(b.price_cents)}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500">
                            Client: <span className="font-medium text-slate-800">{b.client?.name}</span>
                            {b.client?.email && <span> • {b.client.email}</span>}
                            {b.client?.phone && <span> • {b.client.phone}</span>}
                          </p>
                          {b.notes && (
                            <p className="text-xs text-slate-400 italic bg-slate-50 p-2 rounded-lg mt-1 max-w-lg">
                              "{b.notes}"
                            </p>
                          )}
                        </div>

                        {/* Interactive Status Update Buttons */}
                        <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                          {b.status !== 'confirmed' && (
                            <button
                              onClick={() => handleUpdateStatus(b.id, 'confirmed')}
                              className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200 transition"
                            >
                              Confirm
                            </button>
                          )}
                          {b.status !== 'completed' && (
                            <button
                              onClick={() => handleUpdateStatus(b.id, 'completed')}
                              className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200 transition"
                            >
                              Complete
                            </button>
                          )}
                          {b.status !== 'cancelled' && (
                            <button
                              onClick={() => handleUpdateStatus(b.id, 'cancelled')}
                              className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold border border-rose-200 transition"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {bookings.length === 0 && (
                  <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 text-slate-400">
                    <CalendarDays className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                    <p className="font-semibold text-slate-700 text-base">No appointments booked yet</p>
                    <p className="text-xs text-slate-400 mt-1">
                      New appointments booked by clients will appear automatically here.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SERVICES CRUD (IN RUPEES ₹) */}
        {activeTab === 'services' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Services & Pricing (₹)</h1>
                <p className="text-sm text-slate-500 mt-0.5">Manage services, slot durations, and pricing.</p>
              </div>

              <button
                onClick={() => {
                  setEditingService({
                    name: '',
                    description: '',
                    duration_minutes: 30,
                    price_cents: 50000,
                    active: true,
                  });
                  setIsServiceModalOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition"
              >
                <Plus className="w-4 h-4" /> Add Service (₹)
              </button>
            </div>

            {loadingServices ? (
              <div className="h-40 bg-white rounded-3xl border border-slate-200 animate-pulse" />
            ) : (
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-4 px-6">Service Name</th>
                        <th className="py-4 px-6">Duration</th>
                        <th className="py-4 px-6">Price (₹ INR)</th>
                        <th className="py-4 px-6">Status</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {services.map((svc) => (
                        <tr key={svc.id} className="hover:bg-slate-50/50 transition">
                          <td className="py-4 px-6">
                            <p className="font-bold text-slate-900">{svc.name}</p>
                            {svc.description && <p className="text-xs text-slate-500 mt-0.5">{svc.description}</p>}
                          </td>
                          <td className="py-4 px-6 font-medium text-slate-700">{svc.duration_minutes} mins</td>
                          <td className="py-4 px-6 font-bold text-slate-900">{formatRupees(svc.price_cents)}</td>
                          <td className="py-4 px-6">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                svc.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${svc.active ? 'bg-emerald-500' : 'bg-slate-400'}`}
                              />
                              {svc.active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => handleToggleServiceActive(svc)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition"
                              >
                                {svc.active ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingService(svc);
                                  setIsServiceModalOpen(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}

                      {services.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-400">
                            No services created yet. Click "Add Service (₹)" above to start taking client bookings.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modal for Add / Edit Service in Rupees */}
            {isServiceModalOpen && editingService && (
              <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-xl border border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900 mb-4">
                    {editingService.id ? 'Edit Service' : 'Add New Service'}
                  </h3>

                  <form onSubmit={handleSaveService} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                        Service Title *
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="e.g. Haircut & Styling or Dental Checkup"
                        value={editingService.name || ''}
                        onChange={(e) => setEditingService({ ...editingService, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                        Description (Optional)
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Brief summary of what this appointment covers"
                        value={editingService.description || ''}
                        onChange={(e) => setEditingService({ ...editingService, description: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-sm font-medium resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                          Duration (Minutes)
                        </label>
                        <input
                          required
                          type="number"
                          min={5}
                          max={480}
                          step={5}
                          value={editingService.duration_minutes || 30}
                          onChange={(e) =>
                            setEditingService({ ...editingService, duration_minutes: Number(e.target.value) })
                          }
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                          Price in Rupees (₹)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                            ₹
                          </span>
                          <input
                            required
                            type="number"
                            min={0}
                            step={10}
                            placeholder="500"
                            value={Math.round((editingService.price_cents || 0) / 100)}
                            onChange={(e) =>
                              setEditingService({
                                ...editingService,
                                price_cents: Math.round(Number(e.target.value) * 100),
                              })
                            }
                            className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="checkbox"
                        id="activeSvc"
                        checked={editingService.active ?? true}
                        onChange={(e) => setEditingService({ ...editingService, active: e.target.checked })}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <label htmlFor="activeSvc" className="text-xs font-medium text-slate-700">
                        Active for public client bookings
                      </label>
                    </div>

                    <div className="mt-6 flex justify-end gap-2.5 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setIsServiceModalOpen(false)}
                        className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition"
                      >
                        Save Service
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: CLIENTS STATS VIEW */}
        {activeTab === 'clients' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Client Directory & Stats</h1>
              </div>

              {/* Search Bar */}
              <div className="relative max-w-xs w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter name, email, phone..."
                  value={searchClient}
                  onChange={(e) => setSearchClient(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {loadingClients ? (
              <div className="h-40 bg-white rounded-3xl border border-slate-200 animate-pulse" />
            ) : (
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-4 px-6">Client Name</th>
                        <th className="py-4 px-6">Contact Info</th>
                        <th className="py-4 px-6">Total Bookings</th>
                        <th className="py-4 px-6">Lifetime Value (₹)</th>
                        <th className="py-4 px-6">Last Appointment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {clients
                        .filter(
                          (c) =>
                            c.name?.toLowerCase().includes(searchClient.toLowerCase()) ||
                            c.email?.toLowerCase().includes(searchClient.toLowerCase()) ||
                            c.phone?.includes(searchClient)
                        )
                        .map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50/50 transition">
                            <td className="py-4 px-6">
                              <p className="font-bold text-slate-900">{c.name}</p>
                              {c.notes && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{c.notes}</p>}
                            </td>
                            <td className="py-4 px-6 text-xs text-slate-600">
                              {c.email && <p className="font-medium text-slate-800">{c.email}</p>}
                              {c.phone && <p className="text-slate-500">{c.phone}</p>}
                            </td>
                            <td className="py-4 px-6">
                              <span className="font-semibold text-slate-800">{c.total_bookings ?? 0}</span>
                              <span className="text-xs text-slate-400"> ({c.completed_count ?? 0} completed)</span>
                            </td>
                            <td className="py-4 px-6 font-bold text-emerald-600">
                              {formatRupees(c.lifetime_value_cents ?? 0)}
                            </td>
                            <td className="py-4 px-6 text-xs text-slate-500 font-medium">
                              {c.last_appointment
                                ? new Date(c.last_appointment).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })
                                : '—'}
                            </td>
                          </tr>
                        ))}

                      {clients.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-400">
                            No clients registered yet. Clients are automatically captured upon completing their first booking.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
