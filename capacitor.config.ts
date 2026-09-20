import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mep.management',
  appName: 'MEP Management',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    Geolocation: {
      // High accuracy GPS for construction site geofencing
      enableHighAccuracy: true,
      timeout: 10000,
    },
    Camera: {
      // High quality site evidence & snagging photos
      allowEditing: false,
      resultType: 'Base64',
      saveToGallery: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
