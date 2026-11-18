export type Status = "Active" | "All good" | "Busy";

export interface PublicUser { id: string; name: string; username: string; avatarUrl: string | null; status: Status }
export interface Me extends PublicUser {
  email: string | null; phone: string | null; premium: boolean; age: number | null; gender: string | null;
  hasPassword: boolean; doctorId: string | null;
}

export interface Circle {
  id: string; name: string; type: "Family" | "Friends" | "Relatives"; inviteCode: string;
  members: (PublicUser & { role: string })[];
}

export interface Post {
  id: string; kind: "snap" | "checkin" | "activity"; caption: string | null; imageUrl: string | null; createdAt: string;
  author: PublicUser; circle: { id: string; name: string; type: string } | null;
  likeCount: number; commentCount: number; liked: boolean;
}
export interface Comment { id: string; text: string; createdAt: string; user: PublicUser }
export interface StoryGroup { author: PublicUser; stories: { id: string; imageUrl: string; createdAt: string }[] }

export interface Task {
  id: string; title: string; subtitle: string | null; icon: string; dueTime: string | null;
  targetCount: number; doneCount: number; done: boolean;
}
export interface Appointment { id: string; title: string; kind: "doctor" | "call" | "other"; startsAt: string }

export interface PulseEvent { id: string; kind: string; text: string; imageUrl: string | null; createdAt: string; user: PublicUser }
export interface Pulse { members: PublicUser[]; events: PulseEvent[]; summary: "all_good" | "needs_attention" }

export interface Vital { id: string; type: "heart_rate" | "bp" | "spo2"; value: string; unit: string; recordedAt: string }
export interface Medication { id: string; name: string; schedule: string; taken: boolean }
export interface HealthOverview {
  user: { id: string; name: string; age: number | null; gender: string | null; avatarUrl: string | null };
  vitals: Vital[]; medications: Medication[]; nextAppointment: Appointment | null;
}
export interface HealthRecord { id: string; type: string; title: string; notes: string | null; createdAt: string }

export interface Doctor { id: string; name: string; specialty: string; rating: number | null; reviews: number; phone: string | null; avatarUrl: string | null; hasAccount: boolean; linked?: boolean }
export interface DoctorDetail {
  doctor: Doctor; linked: boolean; canMessage: boolean; sharedWith: PublicUser[]; nextAppointment: Appointment | null;
  recordCounts: { type: string; _count: number }[];
}

export interface Game { id: string; title: string; tagline: string; icon: string }
export interface LeaderboardRow { rank: number; user: PublicUser; score: number }

export interface Message { id: string; circleId: string; text: string | null; imageUrl: string | null; createdAt: string; user: PublicUser }

export interface SafetySettings { homeAlerts: boolean; sosAlert: boolean; shareJourney: boolean; homeLat: number | null; homeLng: number | null }
export interface SharedLocation { user: PublicUser; lat: number; lng: number; label: string | null; updatedAt: string; sharingUntil: string }

// ---- added: auth, notifications, premium, support, doctor messaging ----
export interface AuthMethods { email: boolean; phone: boolean; google: boolean; devCodes: boolean }
export interface AppNotification { id: string; kind: string; title: string; body: string; data: Record<string, string>; readAt: string | null; createdAt: string }
export interface Plan { id: "monthly" | "yearly"; title: string; priceLabel: string; days: number }
export interface PlansResponse { enabled: boolean; plans: Plan[]; features: { title: string; free: string; premium: string }[]; devPurchases: boolean }
export interface Subscription { id: string; plan: string; provider: string; status: "active" | "canceled"; expiresAt: string }
export interface PremiumStatus { premium: boolean; subscription: Subscription | null }
export interface SupportTicket { id: string; subject: string; message: string; status: string; createdAt: string }
export interface DoctorMessage { id: string; threadId: string; text: string; createdAt: string; sender: PublicUser }
export interface DoctorThreadSummary { id: string; patient: PublicUser; updatedAt: string; last: DoctorMessage | null; unread: number }
export interface DoctorThreadDetail { id: string; patient: PublicUser; linked: boolean; messages: DoctorMessage[] }
export interface PatientHealth {
  user: { id: string; name: string; age: number | null; gender: string | null; avatarUrl: string | null };
  vitals: Vital[]; medications: Medication[]; records: HealthRecord[];
}
