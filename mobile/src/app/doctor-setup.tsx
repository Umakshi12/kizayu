import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "../api";
import { showAlert, showError } from "../alert";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Button, Card, Field, GradientCard, Header, Loading, Screen } from "../components/ui";
import { colors } from "../theme";

type Profile = { id: string; specialty: string; phone: string | null; patients: number } | null;

// For doctors: turn on a doctor profile so patients can add you by your email and message you.
export default function DoctorSetup() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["doctor-profile"], queryFn: () => get<Profile>("/doctor-portal/profile") });
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => { if (profile.data) { setSpecialty(profile.data.specialty); setPhone(profile.data.phone ?? ""); } }, [profile.data]);

  const save = useMutation({
    mutationFn: () => put("/doctor-portal/profile", { specialty: specialty.trim(), phone: phone.trim() || undefined }),
    onSuccess: async () => {
      haptic.success();
      await refresh();
      qc.invalidateQueries({ queryKey: ["doctor-profile"] });
      showAlert("Doctor profile ready", `Patients can now add you with your email (${user?.email}) and message you.`);
    },
    onError: e => showError("Couldn't save", e),
  });

  return (
    <Screen>
      <Header title="Doctor profile" back />
      {profile.isLoading ? <Loading rows={2} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <GradientCard>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>{profile.data ? "You're set up as a doctor" : "Are you a doctor?"}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 6, lineHeight: 21 }}>
              {profile.data ? `${profile.data.patients} patient${profile.data.patients === 1 ? "" : "s"} added you.` : "Create a doctor profile so patients can add you by your email, message you securely and share their records with you."}
            </Text>
          </GradientCard>
          <Card style={{ marginTop: 16 }}>
            <Field label="Specialty" value={specialty} onChangeText={setSpecialty} autoCapitalize="words" placeholder="General Physician" />
            <Field label="Clinic phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 …" />
            <View style={{ backgroundColor: colors.primaryTint, borderRadius: 14, padding: 12, marginBottom: 16 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Patients find you by your account email: <Text style={{ fontWeight: "700", color: colors.text, fontSize: 13 }}>{user?.email ?? "add an email in Account & Security"}</Text></Text>
            </View>
            <Button title={profile.data ? "Save changes" : "Create doctor profile"} onPress={() => save.mutate()} loading={save.isPending} disabled={specialty.trim().length < 2 || !user?.email} />
          </Card>
          {profile.data && <Button title="Open patient messages" icon="medkit" variant="soft" style={{ marginTop: 14 }} onPress={() => router.push("/doctor-inbox")} />}
        </ScrollView>
      )}
    </Screen>
  );
}
