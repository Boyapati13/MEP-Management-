import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Network } from '@capacitor/network';

export interface GpsResult {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface NetworkInfo {
  connected: boolean;
  connectionType: string;
}

export const nativeService = {
  isNative(): boolean {
    return Capacitor.isNativePlatform();
  },

  getPlatform(): string {
    return Capacitor.getPlatform();
  },

  async getGpsCoordinates(): Promise<GpsResult> {
    if (this.isNative()) {
      try {
        let perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          perm = await Geolocation.requestPermissions({ permissions: ['location'] });
        }
        if (perm.location !== 'granted') {
          throw new Error('GPS location permission denied. Please grant location permissions in device settings.');
        }

        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        });

        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 10,
        };
      } catch (err: any) {
        if (err.message && err.message.includes('permission')) {
          throw err;
        }
        // Fallback if native plugin threw a device-level error
      }
    }

    // Web / Browser Geolocation fallback
    if (!('geolocation' in navigator)) {
      throw new Error('Geolocation is not supported by your device or browser.');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 15,
          });
        },
        (err) => {
          let msg = 'Failed to obtain GPS fix.';
          if (err.code === err.PERMISSION_DENIED) msg = 'GPS permission was denied.';
          else if (err.code === err.POSITION_UNAVAILABLE) msg = 'GPS position unavailable. Ensure device location is on.';
          else if (err.code === err.TIMEOUT) msg = 'GPS request timed out. Please retry in an open area.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
      );
    });
  },

  async capturePhoto(): Promise<string> {
    if (this.isNative()) {
      try {
        let perm = await Camera.checkPermissions();
        if (perm.camera !== 'granted') {
          perm = await Camera.requestPermissions({ permissions: ['camera'] });
        }
        if (perm.camera !== 'granted') {
          throw new Error('Camera permission denied. Please allow camera access in device settings.');
        }

        const image = await Camera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: CameraResultType.Base64,
          source: CameraSource.Prompt,
        });

        if (!image.base64String) {
          throw new Error('No image data captured.');
        }

        return `data:image/${image.format || 'jpeg'};base64,${image.base64String}`;
      } catch (err: any) {
        if (err.message && err.message.includes('denied')) {
          throw err;
        }
        // Fall back to web file picker
      }
    }

    // Web fallback: Trigger file camera input
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';

      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          reject(new Error('No photo selected.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      };

      input.oncancel = () => reject(new Error('Photo capture cancelled.'));
      input.click();
    });
  },

  async getNetworkStatus(): Promise<NetworkInfo> {
    try {
      const status = await Network.getStatus();
      return {
        connected: status.connected,
        connectionType: status.connectionType || 'unknown',
      };
    } catch {
      return {
        connected: typeof navigator !== 'undefined' ? navigator.onLine : true,
        connectionType: 'unknown',
      };
    }
  },
};
