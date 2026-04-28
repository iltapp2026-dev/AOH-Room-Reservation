import React, { useState, useEffect } from 'react';
import { User, Booking, ROOMS } from './types';
import { format, isPast, isSameDay, isSameMonth } from 'date-fns';
import { LogIn, ShieldCheck, LogOut, Settings, Calendar as CalendarIcon, User as UserIcon, Trash2, Edit2, CheckCircle2, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { getMonthDays, getNextMonthFirstWeek, formatDateKey, formatDisplayDate, isDateBookable } from './lib/dateUtils';
import { db, auth } from './lib/firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { onAuthStateChanged, signOut, signInAnonymously } from 'firebase/auth';
import { handleFirestoreError, OperationType } from './lib/firestoreUtils';

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger' }) => {
  const variants = {
    primary: 'bg-maroon text-white hover:bg-maroon-dark shadow-sm hover:shadow-md h-11 px-6 rounded-lg font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none',
    outline: 'border-2 border-maroon text-maroon hover:bg-red-50 h-11 px-6 rounded-lg font-semibold transition-all active:scale-95',
    ghost: 'text-gray-600 hover:bg-gray-100 h-10 px-4 rounded-lg font-medium transition-all',
    danger: 'bg-red-600 text-white hover:bg-red-700 h-11 px-6 rounded-lg font-semibold transition-all active:scale-95',
  };
  return <button className={cn(variants[variant], 'inline-flex items-center justify-center gap-2', className)} {...props} />;
};

const Input = ({ label, required, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; required?: boolean; error?: string }) => (
  <div className="space-y-1 w-full">
    {label && (
      <label className="text-xs font-bold uppercase tracking-wider text-navy opacity-70 ml-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
    )}
    <input 
      className={cn(
        "w-full h-11 px-4 rounded-lg bg-gray-50 border-2 border-gray-200 focus:border-maroon focus:bg-white outline-none transition-all placeholder:text-gray-400 font-medium",
        error && "border-red-500"
      )} 
      required={required}
      {...props} 
    />
    {error && <p className="text-[10px] text-red-500 font-bold uppercase ml-1">{error}</p>}
  </div>
);

// --- Main App Logic ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('aoh_user');
    if (savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch (e) {
        console.error("Failed to restore user:", e);
      }
    }
    return null;
  });
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [adminPin, setAdminPin] = useState(() => localStorage.getItem('aoh_admin_pin') || '7324');
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [bookingModal, setBookingModal] = useState<{ roomId: number; editId?: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isWalking, setIsWalking] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [syncTime, setSyncTime] = useState<Date | null>(null);
  const [bookingPurpose, setBookingPurpose] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      // If we don't have a user, try to sign in anonymously
      // This is required for Firestore to allow writes under the 'isSignedIn()' rule
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (error: unknown) {
          const fbError = error as { code?: string };
          // If Anonymous Auth is disabled in the console, we'll get 'admin-restricted-operation'
          if (fbError.code === 'auth/admin-restricted-operation') {
            console.warn("Anonymous Authentication is disabled in Firebase console. Please enable it in Authentication > Sign-in method.");
          } else {
            console.error("Auth initialization error:", error);
          }
        }
      }
    };
    initAuth();

    // Listen for Auth changes (for our internal session management)
    const unsubscribeAuth = onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser) {
        // If auth is lost, clear local user if it was a deep link or something
        // but generally we keep our 'currentUser' state based on the form
      }
    });

    // Listen for Bookings
    const q = query(collection(db, 'bookings'), orderBy('date', 'asc'));
    const unsubscribeBookings = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      const bookings: Booking[] = [];
      snapshot.forEach((doc) => {
        bookings.push({ id: doc.id, ...doc.data() } as Booking);
      });
      console.log(`Synced ${bookings.length} bookings at ${new Date().toLocaleTimeString()} (Source: ${snapshot.metadata.fromCache ? 'Cache' : 'Server'})`);
      setAllBookings(bookings);
      setSyncTime(new Date());
    }, (error) => {
      console.error("Sync error:", error);
      // Don't throw here to avoid crashing the whole component, just alert
      alert("Real-time sync error. Please refresh the page. " + error.message);
    });

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      unsubscribeAuth();
      unsubscribeBookings();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('aoh_admin_pin', adminPin);
  }, [adminPin]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const email = formData.get('email') as string;

    if (!firstName || !lastName || !email) return;

    const user: User = { firstName, lastName, email, pin: 'VERIFIED' };
    
    // Ensure we are signed in anonymously to interact with Firestore
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Auth error:", error);
      }
    }

    setCurrentUser(user);
    localStorage.setItem('aoh_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    signOut(auth);
    setCurrentUser(null);
    localStorage.removeItem('aoh_user');
    setShowAdminPanel(false);
  };

  const toggleAdmin = () => {
    if (showAdminPanel) {
      setShowAdminPanel(false);
    } else {
      const pin = prompt("Enter Admin PIN:");
      if (pin === adminPin) {
        setShowAdminPanel(true);
      } else if (pin !== null) {
        alert("Incorrect PIN");
      }
    }
  };

  const triggerBooking = (roomId: number) => {
    setIsWalking(true);
    setBookingPurpose('');
    setSelectedDate(null);
    setTimeout(() => {
      setIsWalking(false);
      setBookingModal({ roomId });
    }, 2800);
  };

  const addBooking = async (roomId: number, date: string, editId?: string) => {
    if (!currentUser) return;
    
    // We try to ensure an anonymous session is active for the write operation
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (error: unknown) {
        const fbError = error as { code?: string };
        if (fbError.code === 'auth/admin-restricted-operation') {
          alert("Database Access Error: Anonymous Authentication must be enabled in the Firebase Console (Authentication > Sign-in method) to allow bookings.");
          return;
        }
      }
    }

    if (!bookingPurpose.trim()) {
      alert("Please provide a purpose for the reservation.");
      return;
    }

    const bookingData = {
      roomId,
      date,
      email: currentUser.email,
      firstName: currentUser.firstName,
      lastName: currentUser.lastName,
      purpose: bookingPurpose,
      creatorUid: auth.currentUser?.uid,
      updatedAt: serverTimestamp(),
    };

    setIsSubmitting(true);
    try {
      if (editId) {
        await updateDoc(doc(db, 'bookings', editId), bookingData);
      } else {
        const id = Math.random().toString(36).substr(2, 9);
        await setDoc(doc(db, 'bookings', id), {
          ...bookingData,
          createdAt: serverTimestamp(),
        });
      }

      setBookingModal(null);
      setBookingPurpose('');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1500);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, editId ? `bookings/${editId}` : 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteBooking = async (id: string, firstName: string, lastName: string, email: string) => {
    if (!currentUser) return;
    const booking = allBookings.find(b => b.id === id);
    if (!booking) {
      alert("Booking not found in local state. It might have been already deleted.");
      return;
    }

    // Ensure we have an auth session for deletion if rules require isSignedIn()
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (error: unknown) {
        const fbError = error as { code?: string };
        if (fbError.code === 'auth/admin-restricted-operation') {
          alert("Database Access Error: Anonymous Authentication must be enabled.");
          return;
        }
      }
    }

    const isAdminLocal = currentUser.email === 'admin@iltexas.org' || currentUser.email === 'iltapp2026@gmail.com';

    if (
      isAdminLocal ||
      (booking.firstName.toLowerCase().trim() === firstName.toLowerCase().trim() &&
       booking.lastName.toLowerCase().trim() === lastName.toLowerCase().trim() &&
       booking.email.toLowerCase().trim() === email.toLowerCase().trim())
    ) {
      try {
        await deleteDoc(doc(db, 'bookings', id));
        setPendingDelete(null);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
      } catch (error) {
        console.error("Delete failed:", error);
        alert("Failed to delete reservation. Please check your connection and try again.");
      }
    } else {
      alert("Verification details do not match the original reservation.");
    }
  };

  const manualRefresh = () => {
    window.location.reload();
  };

  const resetDatabase = async () => {
    if (!confirm("ARE YOU SURE? This will PERMANENTLY DELETE ALL reservations for all users/rooms. You cannot undo this.")) return;
    
    try {
      // Note: We delete documents one by one because client-side bulk delete isn't native for entire collections
      const deletePromises = allBookings.map(booking => deleteDoc(doc(db, 'bookings', booking.id)));
      await Promise.all(deletePromises);
      alert("Database reset successful.");
    } catch (error) {
      alert("Error resetting database. Check console for details.");
      console.error(error);
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md border-t-8 border-maroon overflow-hidden"
        >
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-navy leading-tight">AOH – Conference Room<br />Reservation</h1>
          </div>

          <div className="space-y-6">
            {/* Staff Login Section */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <UserIcon className="w-4 h-4 text-maroon" />
                <h2 className="text-xs font-black uppercase tracking-widest text-navy opacity-70">Staff Sign In</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input name="firstName" label="First Name" placeholder="First Name" required />
                <Input name="lastName" label="Last Name" placeholder="Last Name" required />
              </div>
              <Input name="email" type="email" label="Email Address" placeholder="you@iltexas.org" required />
              
              <Button type="submit" className="w-full py-6">
                <LogIn className="w-5 h-5" />
                Sign In to Dashboard
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
              <div className="relative flex justify-center text-[10px] uppercase font-black text-gray-400 bg-white px-4 tracking-widest">or</div>
            </div>

            {/* Admin Login Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-maroon" />
                <h2 className="text-xs font-black uppercase tracking-widest text-navy opacity-70">Admin Access</h2>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input 
                    id="admin-pin-input"
                    type="password" 
                    placeholder="Enter Admin PIN" 
                    maxLength={6} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        if (val === adminPin) {
                          const adminUser = { firstName: 'Admin', lastName: 'Account', email: 'admin@iltexas.org', pin: adminPin };
                          setCurrentUser(adminUser);
                          localStorage.setItem('aoh_user', JSON.stringify(adminUser));
                        } else alert("Incorrect PIN");
                      }
                    }}
                  />
                </div>
                <Button 
                  variant="outline" 
                  className="px-4"
                  onClick={() => {
                    const el = document.getElementById('admin-pin-input') as HTMLInputElement;
                    const val = el.value;
                    if (val === adminPin) {
                      const adminUser = { firstName: 'Admin', lastName: 'Account', email: 'admin@iltexas.org', pin: adminPin };
                      setCurrentUser(adminUser);
                      localStorage.setItem('aoh_user', JSON.stringify(adminUser));
                    } else alert("Incorrect PIN");
                  }}
                >
                  Enter
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Top Alert */}
      <div className="bg-maroon border-b border-maroon-dark text-white py-4 text-center text-base font-black uppercase tracking-wider animate-alert-slow sticky top-0 z-50 shadow-lg px-4">
        ⚠️ Note: Area Office does not supply snacks for meetings.
      </div>

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-11 z-40 shadow-sm">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="font-bold text-navy text-lg tracking-tight">AOH Reservations</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Area Office Conference Rooms</p>
            </div>
          </div>

          <div className="bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
            <span className="text-navy font-bold text-sm tracking-tight">
              {format(currentTime, 'EEEE, MMMM do, yyyy • h:mm:ss a')}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end mr-2">
              <div className="flex items-center gap-1.5">
                <div className={cn("w-1.5 h-1.5 rounded-full", syncTime ? "bg-green-500 animate-pulse" : "bg-gray-300")} />
                <span className="text-[10px] font-bold text-navy opacity-50 uppercase tracking-widest">
                  {syncTime ? `Linked • ${format(syncTime, 'h:mm:ss a')}` : 'Connecting...'}
                </span>
              </div>
            </div>
            <button 
              onClick={manualRefresh}
              className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-1"
            >
              Sync Now
            </button>
            <div className="flex items-center gap-3 bg-gray-50 p-1.5 pr-4 rounded-full border border-gray-100">
              <div className="w-8 h-8 bg-maroon text-white rounded-full flex items-center justify-center font-bold text-xs">
                {currentUser.firstName[0]}{currentUser.lastName[0]}
              </div>
              <span className="text-sm font-bold text-navy">{currentUser.firstName} {currentUser.lastName}</span>
            </div>
            <button 
              onClick={toggleAdmin}
              className={cn("p-2 rounded-lg transition-colors", showAdminPanel ? "bg-maroon text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
            >
              <Settings className="w-5 h-5" />
            </button>
            <button onClick={handleLogout} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 mt-8 space-y-12">
        {/* Admin Section */}
        <AnimatePresence>
          {showAdminPanel && (
            <motion.section 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-navy rounded-xl p-8 text-white space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-maroon" />
                    Admin Control Panel
                  </h3>
                  <button onClick={() => setShowAdminPanel(false)} className="text-white/50 hover:text-white"><X /></button>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                  <div className="bg-white/5 p-6 rounded-lg border border-white/10">
                    <h4 className="font-bold mb-4 uppercase text-xs tracking-widest text-white/60">Global Settings</h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold">Admin PIN</p>
                          <p className="text-xs text-white/50">Used to access this panel</p>
                        </div>
                        <div className="flex gap-2">
                          <input 
                            type="password" 
                            defaultValue={adminPin} 
                            maxLength={6}
                            onBlur={(e) => {
                              if (e.target.value.length >= 4) {
                                setAdminPin(e.target.value);
                                alert("Admin PIN Updated");
                              }
                            }}
                            className="w-20 bg-white/10 border border-white/20 rounded px-2 py-1 text-center font-bold text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/5 p-6 rounded-lg border border-white/10">
                    <h4 className="font-bold mb-4 uppercase text-xs tracking-widest text-white/60">Statistics</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-black">{allBookings.length}</p>
                        <p className="text-[10px] uppercase font-bold text-white/40">Total Bookings</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-black">10</p>
                        <p className="text-[10px] uppercase font-bold text-white/40">Total Rooms</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/5 p-6 rounded-lg border border-red-500/20">
                    <h4 className="font-bold mb-4 uppercase text-xs tracking-widest text-red-400">Danger Zone</h4>
                    <div className="space-y-4">
                      <p className="text-[11px] text-white/60">Permanently delete all reservations. This cannot be undone.</p>
                      <button 
                        onClick={resetDatabase}
                        className="w-full bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/50 py-2 rounded-lg font-bold text-xs transition-all"
                      >
                        Factory Reset Reservations
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Room Grid */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <CalendarIcon className="w-5 h-5 text-maroon" />
            <h3 className="text-xl font-bold text-navy">Conference Rooms</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {ROOMS.map((name, idx) => (
              <RoomCard 
                key={`room-${idx}-${name}`}
                id={idx}
                name={name}
                bookings={allBookings.filter(b => b.roomId === idx)}
                onBook={() => triggerBooking(idx)}
              />
            ))}
          </div>
        </section>

        {/* Bookings Table */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-maroon" />
              <h3 className="text-xl font-bold text-navy">Active Reservations</h3>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Requested On</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Date of Use</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">User</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Room</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Purpose</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allBookings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 font-medium italic">
                      No active reservations found.
                    </td>
                  </tr>
                ) : (
                  [...allBookings]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((booking) => (
                      <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-[11px] text-gray-400 font-medium whitespace-nowrap">
                          {booking.createdAt && typeof booking.createdAt.toDate === 'function' 
                            ? format(booking.createdAt.toDate(), 'MMM d, yyyy') 
                            : 'Recent'}
                        </td>
                        <td className="px-6 py-4 text-[13px] font-bold text-navy whitespace-nowrap">
                          {formatDisplayDate(new Date(booking.date + "T12:00:00"))}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-900">{booking.firstName} {booking.lastName}</span>
                            <span className="text-xs text-gray-400">{booking.email}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 bg-maroon/5 text-maroon text-xs font-bold rounded-full">
                            {ROOMS[booking.roomId]}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-navy font-medium italic opacity-70">
                            {booking.purpose || 'No purpose provided'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {(booking.email === currentUser.email || currentUser.email === 'admin@iltexas.org' || currentUser.email === 'iltapp2026@gmail.com') ? (
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  setBookingPurpose(booking.purpose || '');
                                  setSelectedDate(booking.date);
                                  setBookingModal({ roomId: booking.roomId, editId: booking.id });
                                }}
                                className="p-1.5 text-gray-400 hover:text-maroon hover:bg-red-50 rounded transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => {
                                  setPendingDelete(booking.id);
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300 font-medium italic">Restricted</span>
                          )}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Overlays */}
      <AnimatePresence>
        {isWalking && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-8 backdrop-blur-sm"
          >
            <div className="bg-white rounded-2xl p-12 text-center max-w-lg w-full shadow-2xl relative overflow-hidden">
              <div className="relative h-20 border-b-2 border-dashed border-gray-200 flex items-end">
                <motion.div 
                  initial={{ x: -100 }}
                  animate={{ x: 300 }}
                  transition={{ duration: 2.8, ease: "easeInOut" }}
                  className="text-5xl"
                >
                  🚶‍♂️
                </motion.div>
                <div className="ml-auto text-5xl pb-1">🛎️</div>
              </div>
              <h3 className="mt-8 text-xl font-bold text-navy">Walking to the reception desk...</h3>
              <p className="text-gray-500 mt-2">Preparing your reservation options.</p>
            </div>
          </motion.div>
        )}

        {bookingModal && (
          <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-2 sm:p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border-t-4 border-maroon flex flex-col max-h-[92vh]"
            >
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div className="leading-tight">
                  <h3 className="text-base font-black text-navy uppercase tracking-widest">
                    {bookingModal.editId ? 'Edit Reservation' : 'Room Reservation'}
                  </h3>
                  <p className="text-[11px] font-black text-maroon tracking-widest leading-relaxed">
                    {ROOMS[bookingModal.roomId]}
                  </p>
                </div>
                <button onClick={() => setBookingModal(null)} className="p-1.5 hover:bg-gray-200 rounded-full text-gray-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto p-5 space-y-5 custom-scrollbar">
                <div className="grid grid-cols-1 gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Name" value={`${currentUser.firstName} ${currentUser.lastName}`} readOnly />
                    <Input label="Email" value={currentUser.email} readOnly />
                  </div>
                  <Input 
                    label="Reservation Purpose" 
                    placeholder="e.g. Department Meeting, Training, etc." 
                    value={bookingPurpose}
                    onChange={(e) => setBookingPurpose(e.target.value)}
                    required
                  />
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between mb-3 border-b border-gray-50 pb-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[#A2ABB8]">Select Date</label>
                    <span className="text-[9px] font-bold text-maroon uppercase tracking-widest">NEXT 5 WEEKS</span>
                  </div>
                  
                  <BookingCalendar 
                    roomId={bookingModal.roomId}
                    currentBookings={allBookings}
                    selectedDate={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                    }}
                  />
                </div>

                <div className="pt-2">
                  <Button 
                    variant="primary" 
                    className="w-full py-6 text-base shadow-xl"
                    disabled={!selectedDate || !bookingPurpose.trim() || isSubmitting}
                    onClick={() => {
                      if (selectedDate) {
                        addBooking(bookingModal.roomId, selectedDate, bookingModal.editId);
                      }
                    }}
                  >
                    {isSubmitting ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5" />
                    )}
                    {isSubmitting ? 'Processing...' : (bookingModal.editId ? 'Save Changes' : 'Confirm Reservation')}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {pendingDelete && (
          <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl border-t-4 border-red-600"
            >
              <h3 className="text-xl font-bold text-red-600 flex items-center gap-2 mb-4">
                <LogOut className="rotate-180" />
                Confirm Cancellation
              </h3>
              <p className="text-gray-600 mb-6">To cancel this reservation, please confirm your choice.</p>
              
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                deleteBooking(
                  pendingDelete,
                  (formData.get('f') as string) || '',
                  (formData.get('l') as string) || '',
                  (formData.get('e') as string) || ''
                );
              }} className="space-y-4">
                {(currentUser.email === 'admin@iltexas.org' || currentUser.email === 'iltapp2026@gmail.com') ? (
                  <div className="bg-blue-50 p-4 rounded-lg text-blue-700 text-sm mb-4">
                    Admin bypass active: No verification details required.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Input name="f" placeholder="First Name" required />
                      <Input name="l" placeholder="Last Name" required />
                    </div>
                    <Input name="e" placeholder="Email Address" type="email" required />
                  </>
                )}
                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)} className="flex-1">Nevermind</Button>
                  <Button variant="danger" className="flex-1">Confirm Cancellation</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showSuccess && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-maroon/20 flex items-center justify-center pointer-events-none"
          >
            <motion.div 
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              className="bg-green-500 w-32 h-32 rounded-full flex items-center justify-center shadow-2xl border-4 border-white"
            >
              <CheckCircle2 className="w-16 h-16 text-white" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-Components ---

interface RoomCardProps {
  id: number;
  name: string;
  bookings: Booking[];
  onBook: () => void;
}

const RoomCard: React.FC<RoomCardProps> = ({ id, name, bookings, onBook }) => {
  const now = new Date();
  const currentMonthDays = getMonthDays(now);
  const nextMonthDays = getNextMonthFirstWeek(now);

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col overflow-hidden hover:shadow-2xl transition-all duration-500 group">
      <div className="p-6 flex-1 flex flex-col min-h-[480px]">
        <div className="flex items-center justify-between mb-8">
          <h4 className="text-[13px] font-black uppercase tracking-[0.1em] text-maroon">AVAILABILITY</h4>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#A2ABB8]">{format(now, 'MMMM yyyy')}</span>
        </div>

        <div className="flex-1">
          <div className="grid grid-cols-7 gap-1.5 text-[9px] font-bold mb-4">
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <div key={`header-${id}-${d}-${i}`} className="text-[#A2ABB8] text-center">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {currentMonthDays.map((day, i) => {
              const dKey = formatDateKey(day);
              const booked = bookings.some(b => b.date === dKey);
              const past = isPast(day) && !isSameDay(day, now);
              const isToday = isSameDay(day, now);
              const currentMonth = isSameMonth(day, now);

              return (
                <div 
                  key={`day-${dKey}-${i}`} 
                  className={cn(
                    "aspect-square border border-gray-50 flex flex-col items-center justify-center transition-all relative overflow-hidden rounded-sm",
                    !currentMonth ? "opacity-30" : "bg-white",
                    isToday && "ring-2 ring-maroon/20 border-maroon shadow-inner z-10"
                  )}
                >
                  <span className={cn(
                    "text-[10px] font-black pointer-events-none mb-0.5",
                    !currentMonth ? "text-gray-400" : past ? "text-gray-200" : "text-navy"
                  )}>
                    {day.getDate()}
                  </span>
                  
                  {currentMonth && !past && (
                    <div className="w-1.5 h-1.5 rounded-full overflow-hidden mb-0.5">
                      {booked ? (
                        <div className="w-full h-full bg-red-500 animate-reserved shadow-[0_0_5px_#ef4444]" />
                      ) : (
                        <div className="w-full h-full bg-green-400 animate-led shadow-[0_0_5px_#4ade80]" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-7 gap-1.5 border-t border-gray-50/50 pt-2 pb-1">
            {nextMonthDays.map((day, i) => {
              const dKey = formatDateKey(day);
              const booked = bookings.some(b => b.date === dKey);
              return (
                <div key={`next-${i}`} className="aspect-square border border-gray-50 flex flex-col items-center justify-center bg-gray-50/20 rounded-sm">
                  <span className="text-[10px] font-black text-navy opacity-50 mb-0.5">{day.getDate()}</span>
                  <div className="w-1.5 h-1.5 rounded-full overflow-hidden mb-0.5">
                    {booked ? (
                      <div className="w-full h-full bg-red-500 animate-reserved opacity-80 shadow-[0_0_5px_#ef4444]" />
                    ) : (
                      <div className="w-full h-full bg-green-400 animate-led opacity-80 shadow-[0_0_5px_#4ade80]" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-50 flex items-center justify-center gap-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-led" />
            <span className="text-[9px] font-black uppercase text-[#A2ABB8] tracking-widest">AVAILABLE</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-reserved" />
            <span className="text-[9px] font-black uppercase text-[#A2ABB8] tracking-widest">RESERVED</span>
          </div>
        </div>
      </div>

      <button 
        onClick={onBook}
        className="relative group/btn overflow-hidden bg-white/50 py-5 px-6 border-t border-gray-100 flex items-center justify-between transition-all hover:bg-maroon active:opacity-90"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-base group-hover/btn:bg-white/20 transition-all">
            🏢
          </div>
          <div className="text-left leading-tight">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#A2ABB8] group-hover/btn:text-white/60">Schedule Room</p>
            <h5 className="text-[12px] font-bold text-navy group-hover/btn:text-white leading-tight pr-2">{name}</h5>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center group-hover/btn:border-white/30 group-hover/btn:translate-x-1 transition-all">
          <ChevronRight className="w-4 h-4 text-maroon group-hover/btn:text-white" />
        </div>
      </button>
    </div>
  );
}

function BookingCalendar({ roomId, currentBookings, selectedDate, onSelect }: { roomId: number; currentBookings: Booking[]; selectedDate?: string | null; onSelect: (date: string) => void }) {
  const [viewDate, setViewDate] = useState(new Date());
  
  const days = getMonthDays(viewDate);
  const nextMonthDays = getNextMonthFirstWeek(viewDate);
  const now = new Date();

  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h5 className="font-black text-navy text-base uppercase tracking-widest">{format(viewDate, 'MMMM yyyy')}</h5>
        <div className="flex gap-1">
          <button onClick={() => setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="p-1 sm:p-1.5 hover:bg-gray-100 rounded-full transition-colors text-navy">
            <ChevronRight className="w-4 h-4 rotate-180" />
          </button>
          <button onClick={() => setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="p-1 sm:p-1.5 hover:bg-gray-100 rounded-full transition-colors text-navy">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-3">
        {['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d, i) => (
          <div key={`cal-header-${d}-${i}`} className="text-center text-[8px] font-black uppercase tracking-widest text-gray-400 opacity-60">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5 border-b border-gray-50 pb-5 mb-5">
        {days.map((day, i) => {
          const dKey = formatDateKey(day);
          const bookable = isDateBookable(day);
          const booked = currentBookings.some(b => b.date === dKey && b.roomId === roomId);
          const isSelected = selectedDate === dKey;
          const isToday = isSameDay(day, now);
          const isCurrentMonth = isSameMonth(day, viewDate);

          if (!isCurrentMonth) return <div key={`empty-${i}`} />;

          return (
            <button
              key={`cal-day-${dKey}`}
              disabled={!bookable || booked}
              onClick={() => onSelect(dKey)}
              className={cn(
                "aspect-square rounded-lg flex flex-col items-center justify-center transition-all relative border border-transparent",
                !bookable || booked ? "opacity-30 cursor-not-allowed" : 
                isSelected ? "bg-maroon text-white border-maroon shadow-lg scale-105" :
                "bg-white hover:border-maroon/20 hover:bg-maroon/5 active:scale-95 shadow-sm",
                isToday && !isSelected && "border-[2px] border-maroon scale-105 shadow-md z-10"
              )}
            >
              <span className={cn(
                "text-[11px] font-black mb-0.5",
                isSelected ? "text-white" : booked ? "text-red-400" : "text-navy",
                isToday && !isSelected && "text-maroon"
              )}>
                {day.getDate()}
              </span>

              {isCurrentMonth && bookable && !isSelected && (
                <div className="w-1.5 h-1.5 rounded-full overflow-hidden mb-0.5">
                  {booked ? (
                    <div className="w-full h-full bg-red-600 animate-reserved shadow-[0_0_5px_#dc2626]" />
                  ) : (
                    <div className="w-full h-full bg-green-500 animate-led shadow-[0_0_5px_#22c55e]" />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <h6 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 px-1">Preview Next Month</h6>
        <div className="grid grid-cols-7 gap-1.5">
          {nextMonthDays.map((day, i) => {
            const dKey = formatDateKey(day);
            const bookable = isDateBookable(day);
            const booked = currentBookings.some(b => b.date === dKey && b.roomId === roomId);
            const isSelected = selectedDate === dKey;

            return (
              <button
                key={`next-${i}`}
                disabled={!bookable || booked}
                onClick={() => onSelect(dKey)}
                className={cn(
                  "aspect-square rounded-lg flex flex-col items-center justify-center transition-all relative border border-gray-100",
                  isSelected ? "bg-maroon border-maroon shadow-lg scale-105" :
                  "bg-white hover:border-maroon/20 hover:bg-maroon/5 shadow-sm active:scale-95",
                  booked && !isSelected && "bg-red-50/50 border-transparent"
                )}
              >
                <span className={cn(
                  "text-[10px] font-black mb-0.5",
                  isSelected ? "text-white" : booked ? "text-red-500" : "text-navy opacity-70"
                )}>
                  {day.getDate()}
                </span>
                {!isSelected && (
                  <div className="w-1.5 h-1.5 rounded-full overflow-hidden mb-0.5">
                    {booked ? (
                      <div className="w-full h-full bg-red-600 animate-reserved shadow-[0_0_5px_#dc2626]" />
                    ) : (
                      <div className="w-full h-full bg-green-500 animate-led shadow-[0_0_5px_#22c55e]" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-led shadow-[0_0_5px_#22c55e]" />
            <span className="text-[9px] font-black uppercase tracking-widest text-[#A2ABB8]">Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-600 animate-reserved shadow-[0_0_5px_#dc2626]" />
            <span className="text-[9px] font-black uppercase tracking-widest text-[#A2ABB8]">Reserved</span>
          </div>
        </div>
        <div className="text-[9px] font-black uppercase tracking-widest text-maroon animate-pulse hidden sm:block">
          Select a date to continue
        </div>
      </div>
    </div>
  );
}
