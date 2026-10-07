import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import {
  Calendar,
  Lock,
  Mail,
  Building,
  Globe,
  Clock,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Sparkles,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';

export default function Auth({ initialMode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine mode from prop or path
  const [isSignUp, setIsSignUp] = useState(() => {
    if (initialMode) return initialMode === 'signup';
    return location.pathname.includes('signup');
  });

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Business info for sign up
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    } catch {
      return 'Asia/Kolkata';
    }
  });

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null);
  const [showConfigHelper, setShowConfigHelper] = useState(!isSupabaseConfigured);

  useEffect(() => {
    // If user is already authenticated, take them directly to the dashboard
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/dashboard');
      }
    });

    // Sync mode with route if changed externally
    if (location.pathname.includes('signup')) {
      setIsSignUp(true);
    } else if (location.pathname.includes('login')) {
      setIsSignUp(false);
    }
  }, [location.pathname, navigate]);

  // Auto-slug generator from business name
  const handleBusinessNameChange = (val) => {
    setBusinessName(val);
    const generatedSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 38);
    setSlug(generatedSlug);
  };

  const handleSlugChange = (val) => {
    const cleaned = val
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+/, '')
      .slice(0, 38);
    setSlug(cleaned);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessInfo(null);
    setLoading(true);

    if (!isSupabaseConfigured) {
      setErrorMsg(
        'Supabase is not configured yet. Please open the `.env` file in the project and set valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values from your Supabase project dashboard.'
      );
      setShowConfigHelper(true);
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        if (!businessName.trim()) {
          throw new Error('Please enter your business name.');
        }
        if (!slug.trim()) {
          throw new Error('Please enter a booking URL slug for your business.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters long.');
        }

        // 1. Sign up user with Supabase Auth
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

        if (signUpError) throw signUpError;

        let session = authData?.session;

        // If no session returned directly, attempt instant login
        if (!session) {
          const { data: signInData } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          session = signInData?.session;
        }

        if (session) {
          // 2. Invoke RPC create_business(p_name, p_slug, p_timezone)
          const { error: rpcError } = await supabase.rpc('create_business', {
            p_name: businessName.trim(),
            p_slug: slug.trim().toLowerCase(),
            p_timezone: timezone,
          });

          if (rpcError) {
            const token = session.access_token;
            const apiRes = await fetch('/api/onboarding', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                name: businessName.trim(),
                slug: slug.trim().toLowerCase(),
                timezone,
              }),
            });

            if (!apiRes.ok) {
              const apiJson = await apiRes.json().catch(() => ({}));
              if (rpcError.message !== 'already_has_business') {
                throw new Error(apiJson.error?.message || rpcError.message);
              }
            }
          }

          navigate('/dashboard');
        } else {
          // If Supabase project still requires email confirmation in dashboard settings
          setErrorMsg(
            'Account created, but instant login requires turning off email confirmation in your Supabase project. In Supabase Dashboard, go to Authentication > Providers > Email, turn OFF "Confirm email", and click Save.'
          );
        }
      } else {
        // Login flow
        const { data: loginData, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) throw signInError;

        if (loginData.session) {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      console.error('Auth action failed:', err);
      let message = err.message || 'An unexpected authentication error occurred.';

      if (message.toLowerCase().includes('failed to fetch')) {
        message =
          'Network Connection Error ("Failed to fetch"): The browser could not connect to Supabase. This usually means `VITE_SUPABASE_URL` in `.env` is either unreachable, invalid, or using placeholder keys.';
        setShowConfigHelper(true);
      }

      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Brand Logo & Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform">
            <Calendar className="w-6 h-6" />
          </div>
          <span className="text-2xl font-black tracking-tight text-slate-900">
            Book<span className="text-indigo-600">ly</span>
          </span>
        </Link>
        <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {isSignUp ? 'Start taking appointments' : 'Welcome back'}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {isSignUp
            ? 'Set up your business and accept client bookings in minutes.'
            : 'Sign in to access your appointments and business dashboard.'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        {/* Supabase Config Warning / Diagnostics */}
        {showConfigHelper && (
          <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-amber-900 shadow-xs">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold text-amber-800">Supabase Configuration Required</p>
                <p className="mt-1 text-amber-700 leading-relaxed">
                  Your `.env` file currently contains placeholder Supabase credentials. To connect your active Supabase database:
                </p>
                <ol className="list-decimal ml-4 mt-2 space-y-1 text-amber-800 font-mono text-[11px]">
                  <li>Open <code>.env</code> in the project directory</li>
                  <li>Set <code>VITE_SUPABASE_URL=https://&lt;id&gt;.supabase.co</code></li>
                  <li>Set <code>VITE_SUPABASE_ANON_KEY=&lt;your-anon-key&gt;</code></li>
                </ol>
                <p className="mt-2 text-[11px] text-amber-700">
                  Find these in your <strong>Supabase Dashboard &gt; Project Settings &gt; API</strong>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Auth Card */}
        <div className="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200 sm:px-10">
          {/* Mode Switcher Tabs */}
          <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setErrorMsg(null);
                setSuccessInfo(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                !isSignUp ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
                setErrorMsg(null);
                setSuccessInfo(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                isSignUp ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Create Business
            </button>
          </div>

          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div className="leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {successInfo && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <div className="leading-relaxed">{successInfo}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Business Details (Only shown in Signup mode) */}
            {isSignUp && (
              <div className="space-y-4 pt-1 pb-2 border-b border-slate-100 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Business Name
                  </label>
                  <div className="relative">
                    <Building className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      required={isSignUp}
                      type="text"
                      placeholder="e.g. Skyline Salon or Apex Dental"
                      value={businessName}
                      onChange={(e) => handleBusinessNameChange(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Booking URL Slug
                  </label>
                  <div className="flex rounded-xl border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                    <span className="bg-slate-50 px-3 py-2.5 text-slate-500 text-xs flex items-center border-r border-slate-200 font-mono">
                      /booking/
                    </span>
                    <input
                      required={isSignUp}
                      type="text"
                      placeholder="skyline-salon"
                      value={slug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      className="w-full px-3 py-2.5 focus:outline-none text-slate-800 text-sm font-medium"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Clients will book appointments at this web link.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Timezone
                  </label>
                  <div className="relative">
                    <Clock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      required={isSignUp}
                      type="text"
                      placeholder="Asia/Kolkata"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  required
                  type="email"
                  autoComplete="email"
                  placeholder="owner@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>{isSignUp ? 'Create Business & Account' : 'Sign In to Dashboard'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setErrorMsg(null);
                setSuccessInfo(null);
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold transition"
            >
              {isSignUp ? 'Already registered? Log in to your account' : "Don't have a business account yet? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
