import { ScrollView, View } from "react-native";
import { Text } from "../../components/Text";
import { useLocalSearchParams } from "expo-router";
import { APP_NAME } from "../../config";
import { Header, Screen } from "../../components/ui";
import { colors, radius } from "../../theme";

// TEMPLATE TEXT. Have a lawyer review and adapt both documents for the countries you launch in before publishing.
const DOCS: Record<string, { title: string; sections: [string, string][] }> = {
  terms: {
    title: "Terms of Service",
    sections: [
      ["Using " + APP_NAME, `${APP_NAME} lets you share moments, health information and your location with people you invite into private circles. You must be at least 13 years old (or the minimum age in your country) to use it.`],
      ["Your account", "Keep your sign-in details safe. You're responsible for activity on your account. Tell us right away if you think someone else has access."],
      ["Your content", "You own what you post. You give us permission to store and show it to the people you share it with, only to run the service."],
      ["Acceptable use", "Don't use the app to harass anyone, share illegal content, or access other people's data without permission."],
      ["Not medical or emergency advice", `${APP_NAME} is not a medical device and doesn't replace professional medical advice. SOS alerts notify your circles only. In an emergency, always call your local emergency number.`],
      ["Premium", "Paid plans renew automatically until canceled through the app store you bought from. Canceling keeps Premium until the end of the paid period."],
      ["Changes and termination", "We may update these terms and will tell you about important changes. You can delete your account at any time."],
    ],
  },
  privacy: {
    title: "Privacy Policy",
    sections: [
      ["What we collect", "Account details (name, email or phone), what you post, health data you choose to enter, and your location only while you share it."],
      ["How we use it", "Only to run the app for you and your circles: showing posts, sending notifications, and sharing location with the circle you pick. We don't sell your data."],
      ["Health information", "Health data is visible to members of your circles, and to a doctor only after you link them. You choose which relatives can see it through your doctor."],
      ["Location", "Location is collected only while you're sharing it, and sharing stops automatically after the time you choose. We use it to show you on your circle's map and for arrived-home alerts."],
      ["Who can see your data", "Only the people in the circles you share with, plus service providers that host the app for us (for example cloud hosting, push and SMS/email delivery)."],
      ["Your choices", "You can edit or delete what you've shared, stop location sharing, unlink doctors, and delete your account. Contact us through Help & Support."],
      ["Emergency (SOS) recording", "If you turn on SOS recording and trigger an SOS, the app records short video and audio clips and shares them, with your location, through a private link sent to the emergency contacts you chose and shown to people in your circles. Recording only happens during an SOS you start, while the app is open, with a visible on-screen indicator. Clips are deleted automatically after 30 days, or when you delete your account."],
      ["Security", "Data is sent over encrypted connections and access is limited to what each feature needs."],
    ],
  },
};

export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const d = DOCS[doc ?? ""] ?? DOCS.terms;
  return (
    <Screen>
      <Header title={d.title} back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 680, width: "100%", alignSelf: "center" }}>
        <View style={{ backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: 12, marginBottom: 16 }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>Draft template: to be reviewed by a lawyer before launch.</Text>
        </View>
        {d.sections.map(([h, body]) => (
          <View key={h} style={{ marginBottom: 18 }}>
            <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text, marginBottom: 6 }}>{h}</Text>
            <Text style={{ color: colors.text, lineHeight: 22 }}>{body}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
