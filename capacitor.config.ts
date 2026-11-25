import type { CapacitorConfig } from '@capacitor/cli';

// Android shell config. Portrait is the primary layout; the manifest keeps rotation enabled
// so landscape stays usable (docs/UX_AND_VISUAL_DIRECTION.md §3).
const config: CapacitorConfig = {
  appId: 'com.khiyarusa.worldsimulator',
  appName: 'World Simulator',
  webDir: 'dist',
  android: {
    // The WebView must never mix http content into the local https origin.
    allowMixedContent: false,
    // Debuggable WebView only in local dev builds; CI release builds leave this off.
    webContentsDebuggingEnabled: false,
    backgroundColor: '#12110e',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      backgroundColor: '#12110e',
    },
  },
};

export default config;
