// Kizayu design tokens. Soft lavender surfaces, deep violet accents, generous radii and gentle depth.

export const colors = {
  primary: "#6C3CF0",
  primaryDark: "#4E22C9",
  primarySoft: "#EFE9FF",
  primaryTint: "#F6F2FF",
  accent: "#B65CFF",
  bg: "#F7F4FF",
  card: "#FFFFFF",
  text: "#17112E",
  muted: "#6F6A86",
  faint: "#A9A4BF",
  border: "#ECE7FA",
  hairline: "rgba(108, 60, 240, 0.08)",
  success: "#18B26B",
  successSoft: "#E3F8EE",
  warn: "#F2A100",
  warnSoft: "#FFF4D9",
  danger: "#EF4565",
  dangerSoft: "#FDE8EC",
  gold: "#FFC845",
};

/** Gradient stops (top-left → bottom-right). */
export const gradients = {
  primary: ["#8B5CFF", "#6C3CF0", "#5126D6"] as const,
  hero: ["#7C4DFF", "#9B5CFF", "#C27BFF"] as const,
  premium: ["#2A1563", "#5B2BD9", "#9A5CFF"] as const,
  screen: ["#F9F6FF", "#F3EEFF", "#FBFAFF"] as const,
  ring: ["#8B5CFF", "#D16BFF", "#FF8AC2"] as const,
  danger: ["#FF6B86", "#EF4565"] as const,
  success: ["#2FD08A", "#18B26B"] as const,
  sunrise: ["#FFB36B", "#FF7A9C"] as const,
  ocean: ["#4FC3FF", "#4F7DF3"] as const,
};

export const radius = { xs: 8, sm: 12, md: 18, lg: 24, xl: 30, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
};

export const type = {
  display: { fontSize: 30, fontWeight: "800" as const, letterSpacing: -0.6 },
  title: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: "700" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 13, fontWeight: "600" as const },
  caption: { fontSize: 12, fontWeight: "500" as const },
};

export const shadow = {
  shadowColor: "#3B1E8F",
  shadowOpacity: 0.07,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;

export const glow = {
  shadowColor: "#6C3CF0",
  shadowOpacity: 0.35,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

export const statusColor = (s: string) =>
  s === "Busy" ? colors.warn : s === "All good" || s === "Active" ? colors.success : colors.faint;
