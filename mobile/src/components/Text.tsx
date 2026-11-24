import type { ComponentProps } from "react";
import { StyleSheet, Text as RNText, TextInput as RNTextInput, TextStyle } from "react-native";
import { colors, fonts } from "../theme";

// App-wide text that uses Plus Jakarta Sans. Custom fonts need one family per weight (Android ignores
// fontWeight with custom fonts), so fontWeight is translated into the matching font file here.
// React 19 passes `ref` as a normal prop, so it flows through ...props.
const FAMILY: Record<string, string> = {
  "100": fonts.regular, "200": fonts.regular, "300": fonts.regular, "400": fonts.regular, normal: fonts.regular,
  "500": fonts.medium, "600": fonts.semibold, "700": fonts.bold, bold: fonts.bold, "800": fonts.extrabold, "900": fonts.extrabold,
};

function withFont(style: unknown, base: TextStyle): TextStyle {
  const flat = (StyleSheet.flatten(style as TextStyle) ?? {}) as TextStyle;
  if (flat.fontFamily) return { ...base, ...flat };
  const { fontWeight, ...rest } = flat;
  return { ...base, ...rest, fontFamily: FAMILY[String(fontWeight ?? "400")] ?? fonts.regular };
}

export function Text({ style, ...props }: ComponentProps<typeof RNText>) {
  return <RNText maxFontSizeMultiplier={1.25} {...props} style={withFont(style, { color: colors.text, fontSize: 15 })} />;
}

export function TextInput({ style, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput placeholderTextColor={colors.faint} maxFontSizeMultiplier={1.25} {...props} style={withFont(style, { color: colors.text, fontSize: 16 })} />;
}
