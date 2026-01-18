import { API } from 'homebridge';

// Return type is `any` on purpose.
// Without it, TypeScript tries to emit a declaration for the anonymous class and hits TS4094.
export default function createWifiRSSICharacteristic(api: API): any {
  return class WifiRSSI extends api.hap.Characteristic {
    static readonly UUID = 'B7C80B8A-1C4F-4D2A-A7E4-7B6E0A9F51A7';

    constructor() {
      super('WiFi RSSI', WifiRSSI.UUID, {
        format: api.hap.Formats.INT,
        perms: [api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_READ],
        unit: 'dBm',
        minValue: -100,
        maxValue: 0,
        minStep: 1,
      });

      this.value = this.getDefaultValue();
    }
  };
}
