import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured, Business, Service, Provider } from '../lib/supabase';
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Phone,
  Mail,
  FileText,
  AlertCircle,
  Building2,
  CalendarDays,
  ShieldCheck,
  Check,
  ArrowRight,
  RefreshCw,
  MapPin,
} from 'lucide-react';

interface ClientFormData {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

const STEPS = [
  { id: 1, title: 'Service', icon: Sparkles },
  { id: 2, title: 'Provider', icon: User },
  { id: 3, title: 'Date & Time', icon: CalendarDays },
  { id: 4, title: 'Your Details', icon: FileText },
];

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();

  // Data states
  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<ClientFormData>({
    name: '',
    email: '',
    phone: '',
    notes: '',
  });

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<{
    id: string;
    starts_at: string;
    serviceName: string;
    providerName: string;
  } | null>(null);

  // Fetch business, services & providers by slug
  useEffect(() => {
    async function loadBookingData() {
      if (!slug) return;
      setLoading(true);
      setFetchError(null);

      try {
        // Query business by slug from Supabase
        const { data: bizData, error: bizError } = await supabase
          .from('businesses')
          .select('*')
          .eq('slug', slug.toLowerCase())
          .maybeSingle();

        if (bizError) throw bizError;

        let biz = bizData;
        let svcs: Service[] = [];
        let provs: Provider[] = [];

        // If direct query succeeded
        if (biz) {
          const [servicesRes, providersRes] = await Promise.all([
            supabase
              .from('services')
              .select('*')
              .eq('business_id', biz.id)
              .eq('active', true)
              .order('name'),
            supabase
              .from('providers')
              .select('*')
              .eq('business_id', biz.id)
              .eq('active', true)
              .order('name'),
          ]);

          svcs = servicesRes.data || [];
          provs = providersRes.data || [];
        } else {
          // Fallback to local express API if Supabase table has anon RLS
          const [bizRes, svcRes] = await Promise.all([
            fetch(`/api/public/businesses/${slug}`).then((r) => r.json()),
            fetch(`/api/public/businesses/${slug}/services`).then((r) => r.json()),
          ]);

          if (bizRes.data) {
            biz = bizRes.data;
            svcs = svcRes.data?.services || [];
            provs = svcRes.data?.providers || [];
          } else {
            throw new Error(`Business "${slug}" not found.`);
          }
        }

        setBusiness(biz);
        setServices(svcs);
        setProviders(provs);

        // Pre-select service if only 1 exists
        if (svcs.length === 1) setSelectedService(svcs[0]);
      } catch (err: any) {
        console.error('Error loading booking data:', err);
        setFetchError(err.message || 'Unable to load booking details.');
      } finally {
        setLoading(false);
      }
    }

    loadBookingData();
  }, [slug]);

  // Generate 30-minute time slots for selected date (9:00 AM to 5:00 PM)
  const availableSlots = useMemo(() => {
    if (!selectedDate) return [];
    const slots: string[] = [];
    const [year, month, day] = selectedDate.split('-').map(Number);

    // Standard business hours: 09:00 to 17:00 in 30-min increments
    for (let hour = 9; hour < 17; hour++) {
      for (let min = 0; min < 60; min += 30) {
        const d = new Date(year, month - 1, day, hour, min, 0);
        // Exclude past times if date is today
        if (d.getTime() > Date.now()) {
          slots.push(d.toISOString());
        }
      }
    }
    return slots;
  }, [selectedDate]);

  // Handle Booking submission
  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || !selectedService || !selectedSlot) return;

    if (!clientInfo.name.trim()) {
      setSubmitError('Please enter your name.');
      return;
    }
    if (!clientInfo.email.trim() && !clientInfo.phone.trim()) {
      setSubmitError('Please provide either an email or phone number.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const providerToUse = selectedProvider || providers[0];
    if (!providerToUse) {
      setSubmitError('No provider available for this booking.');
      setIsSubmitting(false);
      return;
    }

    try {
      // 1. Primary: Call Supabase RPC create_booking
      const { data: bookingId, error: rpcError } = await supabase.rpc('create_booking', {
        p_business: business.id,
        p_service: selectedService.id,
        p_provider: providerToUse.id,
        p_start: selectedSlot,
        p_name: clientInfo.name.trim(),
        p_email: clientInfo.email.trim() || null,
        p_phone: clientInfo.phone.trim() || null,
        p_notes: clientInfo.notes.trim() || null,
        p_source: 'public',
      });

      if (rpcError) {
        // Fallback: If anon is restricted on RPC create_booking, try via API
        const fallbackRes = await fetch(`/api/public/businesses/${business.slug}/bookings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: selectedService.id,
            provider_id: providerToUse.id,
            starts_at: selectedSlot,
            name: clientInfo.name.trim(),
            email: clientInfo.email.trim() || undefined,
            phone: clientInfo.phone.trim() || undefined,
            notes: clientInfo.notes.trim() || undefined,
          }),
        });

        const fallbackJson = await fallbackRes.json();
        if (!fallbackRes.ok) {
          throw new Error(fallbackJson.error?.message || rpcError.message);
        }

        setBookingSuccess({
          id: fallbackJson.data?.booking?.id || 'CONFIRMED',
          starts_at: selectedSlot,
          serviceName: selectedService.name,
          providerName: providerToUse.name,
        });
      } else {
        setBookingSuccess({
          id: typeof bookingId === 'string' ? bookingId : 'CONFIRMED',
          starts_at: selectedSlot,
          serviceName: selectedService.name,
          providerName: providerToUse.name,
        });
      }
    } catch (err: any) {
      console.error('Booking submission failed:', err);
      setSubmitError(err.message || 'Could not complete your booking. Please try another slot.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatPrice = (cents: number) => {
    const rupees = Math.round(cents / 100);
    return `₹${rupees.toLocaleString('en-IN')}`;
  };

  const formatSlotTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm w-full">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-800">Loading booking page...</h2>
          <p className="text-sm text-slate-500 mt-1">Preparing available slots and services</p>
        </div>
      </div>
    );
  }

  if (fetchError || !business) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-200 text-center max-w-md w-full">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Booking Page Not Found</h2>
          <p className="text-sm text-slate-600 mt-2">{fetchError || 'Business does not exist or is currently inactive.'}</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition"
          >
            Go to Bookly Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Confirmation Badge / Success View
  if (bookingSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/20 py-12 px-4 flex items-center justify-center">
        <div className="max-w-lg w-full bg-white rounded-3xl shadow-xl shadow-indigo-100/50 border border-slate-100 overflow-hidden text-center p-8 sm:p-10">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 ring-8 ring-emerald-50">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 uppercase tracking-wide">
            <ShieldCheck className="w-3.5 h-3.5" /> Booking Confirmed
          </span>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-4">
            You're all booked!
          </h2>
          <p className="text-slate-600 mt-2 text-sm">
            We've sent the appointment details to{' '}
            <span className="font-semibold text-slate-800">{clientInfo.email || clientInfo.phone}</span>
          </p>

          <div className="mt-8 bg-slate-50 rounded-2xl p-6 text-left border border-slate-100 space-y-4">
            <div className="flex items-start justify-between pb-4 border-b border-slate-200">
              <div>
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Service</span>
                <p className="font-semibold text-slate-900 text-base">{bookingSuccess.serviceName}</p>
              </div>
              <span className="text-sm font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                {selectedService && formatPrice(selectedService.price_cents)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Date & Time</span>
                <p className="font-medium text-slate-800 text-sm mt-0.5">
                  {new Date(bookingSuccess.starts_at).toLocaleDateString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
                <p className="text-xs text-slate-500 font-medium">
                  {formatSlotTime(bookingSuccess.starts_at)}
                </p>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Provider</span>
                <p className="font-medium text-slate-800 text-sm mt-0.5">{bookingSuccess.providerName}</p>
                <p className="text-xs text-slate-500 font-medium">{business.name}</p>
              </div>
            </div>

            <div className="pt-2">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Client</span>
              <p className="text-sm font-medium text-slate-800">{clientInfo.name}</p>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                setBookingSuccess(null);
                setCurrentStep(1);
                setSelectedSlot(null);
                setClientInfo({ name: '', email: '', phone: '', notes: '' });
              }}
              className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition text-sm flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Book Another Session
            </button>
            <Link
              to="/dashboard"
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-md shadow-indigo-200 transition text-sm flex items-center justify-center gap-2"
            >
              Done <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 pb-16">
      {/* Top Banner / Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-lg leading-tight">{business.name}</h1>
              <p className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                {(() => {
                  try {
                    const m = localStorage.getItem(`bookly_meta_${business.id}`);
                    const loc = m ? JSON.parse(m).location : null;
                    if (loc) {
                      return (
                        <span className="font-semibold text-slate-700 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          {loc} •
                        </span>
                      );
                    }
                  } catch {
                    return null;
                  }
                  return null;
                })()}
                <span>{business.timezone}</span>
                {business.phone && <span>• {business.phone}</span>}
              </p>
            </div>
          </div>
          <Link
            to="/login"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50/60 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
          >
            Staff Login
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 mt-8">
        {/* Step Progress Bar */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs mb-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-100 -translate-y-1/2 z-0" />
            {STEPS.map((step) => {
              const StepIcon = step.icon;
              const isCompleted = currentStep > step.id;
              const isCurrent = currentStep === step.id;

              return (
                <div
                  key={step.id}
                  className="flex flex-col items-center relative z-10 cursor-pointer group"
                  onClick={() => {
                    // Allow jumping back to previously completed steps
                    if (isCompleted) setCurrentStep(step.id);
                  }}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
                      isCompleted
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : isCurrent
                        ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-md'
                        : 'bg-white border-2 border-slate-200 text-slate-400 group-hover:border-slate-300'
                    }`}
                  >
                    {isCompleted ? <Check className="w-5 h-5 stroke-[2.5]" /> : <StepIcon className="w-4 h-4" />}
                  </div>
                  <span
                    className={`text-xs font-medium mt-2 hidden sm:block ${
                      isCurrent ? 'text-indigo-600 font-semibold' : isCompleted ? 'text-slate-800' : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Wizard Step Content */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
          {/* STEP 1: Select Service */}
          {currentStep === 1 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">1. Select a Service</h2>
                <p className="text-sm text-slate-500 mt-1">Choose the service you'd like to book today.</p>
              </div>

              {services.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <p>No active services available right now.</p>
                </div>
              ) : (
                <div className="grid gap-3.5">
                  {services.map((svc) => {
                    const isSelected = selectedService?.id === svc.id;
                    return (
                      <div
                        key={svc.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedService(svc)}
                        className={`p-4 sm:p-5 rounded-2xl border-2 transition-all flex items-start justify-between cursor-pointer ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                        }`}
                      >
                        <div className="space-y-1">
                          <h3 className="font-semibold text-slate-900 text-base flex items-center gap-2">
                            {svc.name}
                            {isSelected && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                          </h3>
                          {svc.description && (
                            <p className="text-sm text-slate-500 leading-relaxed max-w-lg">{svc.description}</p>
                          )}
                          <div className="flex items-center gap-4 text-xs font-medium text-slate-500 pt-1">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {svc.duration_minutes} mins
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-4">
                          <span className="text-base font-bold text-slate-900">{formatPrice(svc.price_cents)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  disabled={!selectedService}
                  onClick={() => setCurrentStep(2)}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition flex items-center gap-2 text-sm"
                >
                  Next: Select Provider <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Select Provider */}
          {currentStep === 2 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">2. Choose a Provider</h2>
                <p className="text-sm text-slate-500 mt-1">Select your preferred specialist or staff member.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3.5">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedProvider(null)}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-3.5 ${
                    selectedProvider === null
                      ? 'border-indigo-600 bg-indigo-50/40'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">Any Available Provider</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Fastest availability matching your time</p>
                  </div>
                </div>

                {providers.map((p) => {
                  const isSelected = selectedProvider?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedProvider(p)}
                      className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-3.5 ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/40'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 text-sm">{p.name}</h3>
                        <p className="text-xs text-emerald-600 font-medium mt-0.5">Available for booking</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-5 py-2.5 text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-1.5 transition"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition flex items-center gap-2 text-sm"
                >
                  Next: Pick Date & Time <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Date & 30-min Time Slot */}
          {currentStep === 3 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">3. Select Date & 30-Minute Slot</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Choose a suitable date to view real-time 30-minute booking openings.
                </p>
              </div>

              {/* Date Input */}
              <div className="mb-6">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Select Date
                </label>
                <div className="relative max-w-xs">
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setSelectedSlot(null);
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                  />
                </div>
              </div>

              {/* Slots Grid */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                  Available 30-Minute Slots ({availableSlots.length})
                </label>

                {availableSlots.length === 0 ? (
                  <div className="bg-slate-50 rounded-2xl p-8 text-center text-slate-500 border border-slate-200">
                    <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium">No available slots for this date.</p>
                    <p className="text-xs text-slate-400 mt-1">Please try choosing tomorrow or a future date.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                    {availableSlots.map((slotIso) => {
                      const isSelected = selectedSlot === slotIso;
                      return (
                        <button
                          key={slotIso}
                          type="button"
                          onClick={() => setSelectedSlot(slotIso)}
                          className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all text-center ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm ring-2 ring-indigo-200'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50/30'
                          }`}
                        >
                          {formatSlotTime(slotIso)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-8 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-5 py-2.5 text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-1.5 transition"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  disabled={!selectedSlot}
                  onClick={() => setCurrentStep(4)}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition flex items-center gap-2 text-sm"
                >
                  Next: Contact Details <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Client Info & Submit */}
          {currentStep === 4 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">4. Enter Your Information</h2>
                <p className="text-sm text-slate-500 mt-1">Provide contact details for booking confirmation and reminders.</p>
              </div>

              {submitError && (
                <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-500" />
                  <div>
                    <p className="font-semibold">Booking Issue</p>
                    <p className="text-xs text-rose-600 mt-0.5">{submitError}</p>
                  </div>
                </div>
              )}

              {/* Order Summary Pill */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">{selectedService?.name}</span>
                  <span className="text-slate-500"> • {selectedService?.duration_minutes} mins</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="font-medium">
                    {selectedSlot &&
                      new Date(selectedSlot).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                    at {selectedSlot && formatSlotTime(selectedSlot)}
                  </span>
                </div>
                <span className="font-bold text-indigo-700 text-sm">
                  {selectedService && formatPrice(selectedService.price_cents)}
                </span>
              </div>

              <form onSubmit={handleSubmitBooking} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      required
                      type="text"
                      placeholder="e.g. Alex Morgan"
                      value={clientInfo.name}
                      onChange={(e) => setClientInfo({ ...clientInfo, name: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        placeholder="alex@example.com"
                        value={clientInfo.email}
                        onChange={(e) => setClientInfo({ ...clientInfo, email: e.target.value })}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="tel"
                        placeholder="+1 (555) 000-0000"
                        value={clientInfo.phone}
                        onChange={(e) => setClientInfo({ ...clientInfo, phone: e.target.value })}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Special Notes / Requests (Optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Any specific requests or requirements..."
                    value={clientInfo.notes}
                    onChange={(e) => setClientInfo({ ...clientInfo, notes: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-sm font-medium resize-none"
                  />
                </div>

                <p className="text-xs text-slate-400 italic">
                  * At least one contact method (email or phone) is required to receive appointment confirmation.
                </p>

                <div className="mt-8 pt-4 flex justify-between items-center border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="px-5 py-2.5 text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-1.5 transition"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !clientInfo.name || (!clientInfo.email && !clientInfo.phone)}
                    className="px-7 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-md shadow-emerald-200 transition flex items-center gap-2 text-sm"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Confirming Booking...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" /> Confirm & Book Appointment
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
