import TuyaDevice from './TuyaDevice';
import TuyaDeviceManager from './TuyaDeviceManager';

export default class TuyaHomeDeviceManager extends TuyaDeviceManager {
  private lastSignalPollMs = new Map<string, number>();
  private signalPollInFlight = new Set<string>();
  private static readonly SIGNAL_LEVEL_MAP: Record<string, string> = {
    '优': 'Excellent',
    '优秀': 'Excellent',
    '良': 'Good',
    '一般': 'Fair',
    '差': 'Poor',
  };


  async getHomeList() {
    const res = await this.api.get(`/v1.0/users/${this.api.tokenInfo.uid}/homes`);
    return res;
  }

  async getHomeDeviceList(homeID: number) {
    const res = await this.api.get(`/v1.0/homes/${homeID}/devices`);
    return res;
  }

  async updateDevices(homeIDList: number[]) {

    let devices: TuyaDevice[] = [];
    for (const homeID of homeIDList) {
      const res = await this.getHomeDeviceList(homeID);
      devices = devices.concat((res.result as []).map(obj => new TuyaDevice(obj)));
    }
    if (devices.length === 0) {
      return [];
    }

    for (const device of devices) {
      device.schema = await this.getDeviceSchema(device.id);

      const now = Date.now();

      const last = this.lastSignalPollMs.get(device.id) ?? 0;
      if (now - last < 60 * 60 * 1000) { // 1 hour
        continue;
      }

      // Prevent duplicate concurrent polls
      if (this.signalPollInFlight.has(device.id)) {
        continue;
      }

      this.signalPollInFlight.add(device.id);
      // IMPORTANT: set the timestamp BEFORE awaiting anything
      this.lastSignalPollMs.set(device.id, now);
      this.api.issueSignalDetection(device.id, 'WiFi');

        try {
          const sig = await this.api.getThingSignal(device.id, 'wifi');
        //  this.log.debug('getThingSignal response raw=%s\n', JSON.stringify(sig));
          const r = sig?.result ?? {};

          (device as any).extra = (device as any).extra || {};
          (device as any).extra.wifiRssi = (r as any).signal;
          (device as any).extra.wifiSignalLevelRaw = (r as any).signalLevel;
          (device as any).extra.wifiSignalLevelEn = (() => {
            const raw = (r as any).signalLevel;
            const s = (raw === null || raw === undefined) ? '' : String(raw);
            const mapped = TuyaHomeDeviceManager.SIGNAL_LEVEL_MAP[s];
            if (mapped) {
              return mapped;
            }
            if (/[A-Za-z]/.test(s)) {
              return s;
            }
            return 'Unknown';
          })();
          (device as any).extra.wifiSignalEventTime = (r as any).eventTime;

/*          this.log.warn(
            '[%s] signal(wifi) rssi=%s level=%s event_time=%s raw=%s',
            device.name,
            (r as any).signal ?? 'n/a',
            (r as any).signalLevel ?? 'n/a',
            (r as any).eventTime ?? 'n/a',
            JSON.stringify(sig),
          );
*/        } catch (e) {
          this.log.warn('[%s] signal(wifi) error=%s', device.name, (e as Error)?.message ?? String(e));
        } finally {
          this.signalPollInFlight.delete(device.id);
        }
    }

    this.devices = devices;
    return devices;
  }

  async getSceneList(homeID: number) {
    const res = await this.api.get(`/v1.1/homes/${homeID}/scenes`);
    if (res.success === false) {
      this.log.warn('Get scene list failed. homeId = %d, code = %s, msg = %s', homeID, res.code, res.msg);
      return [];
    }

    const scenes: TuyaDevice[] = [];
    for (const { scene_id, name, enabled, status } of res.result) {
      if (enabled !== true || status !== '1') {
        continue;
      }

      scenes.push(new TuyaDevice({
        id: scene_id,
        uuid: scene_id,
        name,
        owner_id: homeID.toString(),
        product_id: 'scene',
        category: 'scene',
        schema: [],
        status: [],
        online: true,
      }));
    }
    return scenes;
  }

  async executeScene(homeID: string | number, sceneID: string) {
    const res = await this.api.post(`/v1.0/homes/${homeID}/scenes/${sceneID}/trigger`);
    return res;
  }
}
