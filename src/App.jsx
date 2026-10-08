import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import BookingPage from './pages/BookingPage';
import Auth from './pages/Auth';
import Dashboard from './pages/dashboard/Dashboard';
import {
  Calendar,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Clock,
  Users,
  CheckCircle2,
  ChevronRight,
  Zap,
} from 'lucide-react';
import './style.css';

function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-indigo-500 selection:text-white flex flex-col justify-between">
      {/* Navbar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-100">
              <Calendar className="w-5 h-5" />
            </div>
            <span className="text-xl font-black tracking-tight text-slate-900">
              Book<span className="text-indigo-600">ly</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 px-3.5 py-2 rounded-xl hover:bg-slate-100 transition"
            >
              Sign In
            </Link>
            <Link
              to="/signup"
              className="text-xs sm:text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl shadow-sm shadow-indigo-200 transition flex items-center gap-1.5"
            >
              Create Business <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-4 py-16 sm:py-24 text-center my-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold mb-6 shadow-xs">
          <Sparkles className="w-3.5 h-3.5" /> Effortless appointment scheduling for your business.
        </div>

        <h1 className="text-4xl sm:text-6xl font-black text-slate-900 tracking-tight leading-tight max-w-3xl mx-auto">
          Smart scheduling, simplified.
        </h1>

        <p className="mt-6 text-base sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Let clients book appointments 24/7 while you manage schedules, services, and staff all in one place
        </p>

        <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/signup"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-lg shadow-indigo-200 transition flex items-center justify-center gap-2"
          >
            Get Started Free <ChevronRight className="w-4 h-4" />
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-white hover:bg-slate-100 text-slate-800 font-bold text-sm border border-slate-200 transition flex items-center justify-center gap-2 shadow-xs"
          >
            Dashboard Login
          </Link>
        </div>

        {/* Feature Highlights Grid */}
        <div className="mt-16 sm:mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h2 className="font-bold text-slate-900 text-base">4-Step Public Wizard</h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Step-by-step service, specialist, 30-minute time slot selection, and customer confirmation badge.
            </p>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h2 className="font-bold text-slate-900 text-base">Double-Booking Guard</h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Backed by PostgreSQL exclusion constraints and transactional advisory locks in Supabase.
            </p>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-4">
              <Users className="w-5 h-5" />
            </div>
            <h2 className="font-bold text-slate-900 text-base">CRM & Client Stats</h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Real-time lifetime values (LTV), completed visit counts, and appointment histories at a glance.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        Bookly © {new Date().getFullYear()} • Powered by Supabase & React
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Auth initialMode="login" />} />
        <Route path="/signup" element={<Auth initialMode="signup" />} />
        <Route path="/booking/:slug" element={<BookingPage />} />
        <Route path="/dashboard/*" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
