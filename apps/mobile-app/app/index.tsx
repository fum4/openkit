import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [isScanEnabled, setIsScanEnabled] = useState(true);

  const helperText = useMemo(() => {
    if (!permission) return "Checking camera permission...";
    if (!permission.granted) return "Camera permission is required to scan QR codes.";
    if (lastScannedCode) return `Scanned: ${lastScannedCode}`;
    return "Align a QR code inside the frame.";
  }, [permission, lastScannedCode]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <StatusBar style="light" />
        <Text style={styles.message}>{helperText}</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <StatusBar style="light" />
        <Text style={styles.message}>{helperText}</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Permission</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.cameraWrap}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            isScanEnabled
              ? ({ data }) => {
                  setLastScannedCode(data);
                  setIsScanEnabled(false);
                }
              : undefined
          }
        />
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.scanFrame} />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.message}>{helperText}</Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            setLastScannedCode(null);
            setIsScanEnabled(true);
          }}
        >
          <Text style={styles.buttonText}>Scan Another Code</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#090b10",
  },
  centeredContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#090b10",
    paddingHorizontal: 24,
    gap: 16,
  },
  cameraWrap: {
    flex: 1,
    margin: 16,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#273043",
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 10, 14, 0.26)",
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderWidth: 2,
    borderRadius: 18,
    borderColor: "#39d98a",
    backgroundColor: "transparent",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  message: {
    color: "#e9eefc",
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    backgroundColor: "#39d98a",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  buttonText: {
    color: "#081017",
    fontWeight: "700",
  },
});
