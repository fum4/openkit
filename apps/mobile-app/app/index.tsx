import { CameraView, useCameraPermissions } from "expo-camera";
import { Link, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { getErrorMessage, parseConnectionPayloadFromQrData } from "./lib/ngrok-connect";

type ConnectionStatus = "idle" | "connecting" | "error";

interface ConnectionState {
  status: ConnectionStatus;
  message: string;
}

const defaultConnectionState: ConnectionState = {
  status: "idle",
  message: "Align an OpenKit ngrok pairing QR inside the frame.",
};

export default function QRScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [isScanEnabled, setIsScanEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>(defaultConnectionState);

  const resetScanner = useCallback(() => {
    setLastScannedCode(null);
    setConnectionState(defaultConnectionState);
    setIsScanEnabled(true);
  }, []);

  const checkGateway = useCallback(
    async (qrData: string) => {
      setLastScannedCode(qrData);
      setIsScanEnabled(false);
      setConnectionState({
        status: "connecting",
        message: "Opening connect flow...",
      });

      try {
        const payload = parseConnectionPayloadFromQrData(qrData);
        router.push({
          pathname: "/connect",
          params: {
            origin: payload.origin,
            token: payload.token,
          },
        });
      } catch (error) {
        setIsScanEnabled(true);
        setConnectionState({
          status: "error",
          message: getErrorMessage(error),
        });
      }
    },
    [router],
  );

  const helperText = useMemo(() => {
    if (!permission) return "Checking camera permission...";
    if (!permission.granted) return "Camera permission is required to scan QR codes.";
    return connectionState.message;
  }, [connectionState.message, permission]);

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
                  void checkGateway(data);
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
        <Text style={styles.hintText}>
          Or scan the QR with your phone camera to open the app directly.
        </Text>

        {lastScannedCode ? (
          <Text style={styles.detailText} numberOfLines={2}>
            Scanned URL: {lastScannedCode}
          </Text>
        ) : null}

        <Pressable
          style={[
            styles.button,
            connectionState.status === "connecting" ? styles.buttonDisabled : null,
          ]}
          disabled={connectionState.status === "connecting"}
          onPress={resetScanner}
        >
          <Text style={styles.buttonText}>Scan Another Code</Text>
        </Pressable>

        <Link href="/connect" style={styles.linkText}>
          Open Deep-Link Connect Screen
        </Link>
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
  hintText: {
    color: "#a9b6d9",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
  },
  detailText: {
    color: "#c6d4f5",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#081017",
    fontWeight: "700",
  },
  linkText: {
    color: "#8ab4ff",
    textAlign: "center",
    textDecorationLine: "underline",
    fontSize: 12,
  },
});
