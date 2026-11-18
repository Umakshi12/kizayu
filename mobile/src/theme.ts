// Kizayu design tokens, matched to the logo: electric cyan on deep black.
// Cyan is the accent (icons, links, highlights); deep ink gradients carry white text, so contrast stays high.

export const colors = {
  primary: "#0088B8",      // readable cyan for text, icons and borders on white
  primaryDark: "#00668C",
  primarySoft: "#DDF5FC",
  primaryTint: "#EFFAFD",
  accent: "#00D4FF",       // logo cyan, for glows and highlights on dark surfaces
  ink: "#0A0D12",          // logo black
  bg: "#F4F8FA",
  card: "#FFFFFF",
  text: "#0B1220",
  muted: "#5E6A78",
  faint: "#A2ACB8",
  border: "#E2EAEF",
  hairline: "rgba(0, 136, 184, 0.10)",
  success: "#18B26B",
  successSoft: "#E3F8EE",
  warn: "#F2A100",
  warnSoft: "#FFF4D9",
  danger: "#EF4565",
  dangerSoft: "#FDE8EC",
  gold: "#FFC845",
  scrim: "rgba(10, 13, 18, 0.55)",
};

/** Gradient stops (top-left → bottom-right). */
export const gradients = {
  primary: ["#1A2430", "#0E151D", "#05080C"] as const,   // ink buttons with white text
  hero: ["#0A0D12", "#0B1F2B", "#00506A"] as const,       // black fading into deep cyan
  premium: ["#05080C", "#0D1B26", "#006E8F"] as const,
  screen: ["#F6FAFC", "#EEF6FA", "#FAFCFD"] as const,
  ring: ["#00D4FF", "#0096D6", "#7FF0FF"] as const,
  danger: ["#FF6B86", "#EF4565"] as const,
  success: ["#2FD08A", "#18B26B"] as const,
  sunrise: ["#FFB36B", "#FF7A9C"] as const,
  ocean: ["#3FD8FF", "#0088B8"] as const,
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
  shadowColor: "#0B2533",
  shadowOpacity: 0.07,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;

/** Cyan glow under dark buttons and hero cards, like the logo on black. */
export const glow = {
  shadowColor: "#00B8E6",
  shadowOpacity: 0.35,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

export const statusColor = (s: string) =>
  s === "Busy" ? colors.warn : s === "All good" || s === "Active" ? colors.success : colors.faint;
