import { Linking } from "react-native";
import { showAlert } from "./alert";
import * as ImagePicker from "expo-image-picker";
import { uploadImage } from "./api";

/** Capture or pick an image, upload it, and return its public URL (or null if cancelled). */
export async function pickAndUpload(source: "camera" | "library"): Promise<string | null> {
  const perm = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    showAlert(
      source === "camera" ? "Camera access needed" : "Photo access needed",
      "Please allow access in Settings to continue.",
      [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }],
    );
    return null;
  }
  const opts = { quality: 0.6, base64: true, allowsEditing: false };
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]?.base64) return null;
  return uploadImage(res.assets[0].base64, res.assets[0].uri);
}
