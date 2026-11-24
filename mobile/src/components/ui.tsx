import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Pressable, StyleProp, StyleSheet, TextInputProps, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { colors, glow, gradients, radius, shadow, statusColor, type } from "../theme";
import { mediaUrl } from "../api";
import { haptic } from "../haptics";
import { Text, TextInput } from "./Text";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Grad = readonly [string, string, ...string[]];

// ---------- Layout ----------

/** Every screen sits on a soft lavender gradient. */
export function Screen({ children, style, tab }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tab?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={gradients.screen} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      {/* Keep content clear of the status bar, and (on non-tab screens) of the phone's navigation bar. Tab screens leave the bottom to the tab bar. */}
      <SafeAreaView edges={tab ? ["top"] : ["top", "bottom"]} style={[{ flex: 1 }, style]}>{children}</SafeAreaView>
    </View>
  );
}

export function IconButton({ icon, onPress, label, badge, tint = colors.text }: { icon: IconName; onPress: () => void; label: string; badge?: number; tint?: string }) {
  return (
    <Pressable onPress={() => { haptic.tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [s.iconBtn, pressed && { transform: [{ scale: 0.94 }] }]}>
      <Ionicons name={icon} size={21} color={tint} />
      {!!badge && (
        <View style={s.badge}><Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{badge > 9 ? "9+" : badge}</Text></View>
      )}
    </Pressable>
  );
}

export function Header({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      {back && <View style={{ marginRight: 12 }}><IconButton icon="chevron-back" label="Go back" onPress={() => router.back()} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={{ color: colors.muted, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ---------- Surfaces ----------

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (!onPress) return <View style={[s.card, style]}>{children}</View>;
  return (
    <Pressable onPress={() => { haptic.tap(); onPress(); }} style={({ pressed }) => [s.card, style, pressed && { transform: [{ scale: 0.985 }], opacity: 0.96 }]}>
      {children}
    </Pressable>
  );
}

export function GradientCard({ children, colors: c = gradients.hero, style }: { children: React.ReactNode; colors?: Grad; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius.lg, padding: 20, overflow: "hidden" }, glow, style]}>
      {/* soft decorative orbs */}
      <View pointerEvents="none" style={[s.orb, { width: 160, height: 160, top: -60, right: -40 }]} />
      <View pointerEvents="none" style={[s.orb, { width: 90, height: 90, bottom: -30, left: -20, opacity: 0.08 }]} />
      {children}
    </LinearGradient>
  );
}

/** Rounded icon tile with a soft tinted (or gradient) background. */
export function IconTile({ icon, color = colors.primary, bg = colors.primarySoft, size = 44, gradient }: { icon: IconName; color?: string; bg?: string; size?: number; gradient?: Grad }) {
  const inner = <Ionicons name={icon} size={size * 0.5} color={gradient ? "#fff" : color} />;
  const box = { width: size, height: size, borderRadius: size * 0.32, alignItems: "center" as const, justifyContent: "center" as const };
  return gradient
    ? <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={box}>{inner}</LinearGradient>
    : <View style={[box, { backgroundColor: bg }]}>{inner}</View>;
}

export function Pill({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={() => { haptic.select(); onPress?.(); }} accessibilityRole="button" accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [s.pill, active && s.pillActive, pressed && { opacity: 0.85 }]}>
      {active && <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />}
      {icon && <Ionicons name={icon} size={15} color={active ? "#fff" : colors.muted} style={{ marginRight: 6 }} />}
      <Text style={{ fontWeight: "700", fontSize: 13, color: active ? "#fff" : colors.text }}>{label}</Text>
    </Pressable>
  );
}

// ---------- Controls ----------

export function Button({ title, onPress, variant = "primary", loading, disabled, icon, style, size = "md" }: {
  title: string; onPress: () => void; variant?: "primary" | "soft" | "danger" | "ghost" | "light";
  loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; size?: "md" | "sm";
}) {
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "light" ? colors.primaryDark : colors.primary;
  const grad = variant === "primary" ? gradients.primary : variant === "danger" ? gradients.danger : null;
  const bg = variant === "soft" ? colors.primarySoft : variant === "light" ? "#fff" : "transparent";
  const h = size === "sm" ? 38 : 52;
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }} disabled={disabled || loading} accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [
        { borderRadius: radius.pill, height: h, overflow: "hidden", opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        grad && !disabled && glow, style,
      ]}
    >
      {grad && <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      <View style={{ height: h, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: size === "sm" ? 16 : 22, backgroundColor: grad ? "transparent" : bg, borderWidth: variant === "ghost" ? 1.5 : 0, borderColor: colors.border, borderRadius: radius.pill }}>
        {loading ? <ActivityIndicator color={fg} /> : (
          <>
            {icon && <Ionicons name={icon} size={size === "sm" ? 16 : 19} color={fg} style={{ marginRight: 8 }} />}
            <Text numberOfLines={1} style={{ color: fg, fontWeight: "700", fontSize: size === "sm" ? 14 : 16 }}>{title}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string }) {
  const { label, hint, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        autoCapitalize="none" {...rest}
        onFocus={e => { setFocused(true); onFocus?.(e); }} onBlur={e => { setFocused(false); onBlur?.(e); }}
        style={[s.input, focused && s.inputFocused, style]}
      />
      {hint ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{hint}</Text> : null}
    </View>
  );
}

// ---------- People ----------

export function Avatar({ uri, name, size = 44, ring, status }: { uri?: string | null; name?: string; size?: number; ring?: boolean; status?: string }) {
  const pad = ring ? 3 : 0;
  const inner = size - pad * 2 - (ring ? 2 : 0);
  const face = uri ? (
    <Image source={{ uri: mediaUrl(uri) }} style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: colors.primarySoft }} />
  ) : (
    <LinearGradient colors={["#E3F7FD", "#C9EEF9"]} style={{ width: inner, height: inner, borderRadius: inner / 2, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.primary, fontWeight: "800", fontSize: inner / 2.5 }}>{initials(name)}</Text>
    </LinearGradient>
  );
  return (
    <View style={{ width: size, height: size }}>
      {ring ? (
        <LinearGradient colors={gradients.ring} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, padding: pad }}>
          <View style={{ flex: 1, borderRadius: size / 2, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>{face}</View>
        </LinearGradient>
      ) : face}
      {status && <View style={[s.dot, { backgroundColor: statusColor(status), width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13 }]} />}
    </View>
  );
}
const initials = (name?: string) => (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";

// ---------- Text helpers ----------

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.section}>
      <Text style={type.heading}>{title}</Text>
      {action && (
        <Pressable onPress={() => { haptic.tap(); onAction?.(); }} hitSlop={8} style={s.sectionAction}>
          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------- States ----------

function Shimmer({ style }: { style: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: "#E1EBF0", borderRadius: radius.sm, opacity: v }, style]} />;
}

/** Placeholder cards while content loads. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ padding: 16, gap: 14 }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[s.card, { flexDirection: "row", gap: 12, alignItems: "center" }]}>
          <Shimmer style={{ width: 46, height: 46, borderRadius: 23 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <Shimmer style={{ height: 14, width: "60%" }} />
            <Shimmer style={{ height: 12, width: "85%" }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Empty icon="cloud-offline-outline" title="Couldn't load this"
      text={error instanceof Error ? error.message : "Something went wrong"} actionLabel={onRetry ? "Try again" : undefined} onAction={onRetry} />
  );
}

export function Empty({ icon = "sparkles-outline", title, text, actionLabel, onAction, compact }: {
  icon?: IconName; title?: string; text: string; actionLabel?: string; onAction?: () => void; compact?: boolean;
}) {
  return (
    <View style={{ alignItems: "center", paddingVertical: compact ? 18 : 36, paddingHorizontal: 24 }}>
      <LinearGradient colors={["#EAF8FD", "#D3F2FB"]} style={{ width: compact ? 56 : 76, height: compact ? 56 : 76, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <Ionicons name={icon} size={compact ? 26 : 34} color={colors.primary} />
      </LinearGradient>
      {title && <Text style={{ fontWeight: "800", fontSize: 17, textAlign: "center", marginBottom: 4 }}>{title}</Text>}
      <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 21, maxWidth: 320 }}>{text}</Text>
      {actionLabel && onAction && <Button title={actionLabel} onPress={onAction} size="sm" style={{ marginTop: 16, alignSelf: "center" }} />}
    </View>
  );
}

// ---------- Formatting ----------

export function timeAgo(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} • ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
  headerTitle: { ...type.title, color: colors.text },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.hairline, ...shadow },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: "#fff" },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.hairline, ...shadow },
  orb: { position: "absolute", borderRadius: 999, backgroundColor: "#fff", opacity: 0.12 },
  pill: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 9, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  pillActive: { borderColor: "transparent" },
  dot: { position: "absolute", right: 0, bottom: 0, borderWidth: 2.5, borderColor: "#fff" },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 12 },
  sectionAction: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  label: { ...type.label, color: colors.text, marginBottom: 8 },
  input: { backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 },
  inputFocused: { borderColor: colors.primary, backgroundColor: "#FBFEFF" },
});
