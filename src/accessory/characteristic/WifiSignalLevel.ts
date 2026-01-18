import { API } from 'homebridge';

// Return type is `any` on purpose.
// Without it, TypeScript tries to emit a declaration for the anonymous class and hits TS4094.
export default function createWifiSignalLevelCharacteristic(api: API): any {
  return class WifiSignalLevel extends api.hap.Characteristic {
    static readonly UUID = 'E9E4D1C5-4E4F-4C3B-9F2B-7C9D0D5C2A1B';

    constructor() {
      super('WiFi Signal Level', WifiSignalLevel.UUID, {
        format: api.hap.Formats.STRING,
        perms: [api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_READ],
      });

      this.value = this.getDefaultValue();
    }
  };
}
