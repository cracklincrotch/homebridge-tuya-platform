import { TuyaDeviceSchema, TuyaDeviceSchemaType } from '../device/TuyaDevice';
import BaseAccessory from './BaseAccessory';
import { configureName } from './characteristic/Name';
import { configureOn } from './characteristic/On';

type BoolDp = {
  code: string;
  name: string;
  service: 'Switch' | 'Lightbulb';
  momentary?: boolean;
};

const DPS: BoolDp[] = [
  { code: 'switch1',          name: 'Power',        service: 'Switch' },
  { code: 'lightloop_switch', name: 'Light Ring',   service: 'Lightbulb' },
  { code: 'deodorize',        name: 'Deodorize',    service: 'Switch' },
  { code: 'UV_autoswitch',    name: 'UV Auto',      service: 'Switch' },
  { code: 'sleepmode_switch', name: 'Sleep Mode',   service: 'Switch' },

  // “Buttons”
  { code: 'manual',           name: 'Clean Now',    service: 'Switch', momentary: true },
  { code: 'reset',            name: 'Reset',        service: 'Switch', momentary: true },

  // write-only; expose if schema exists
  { code: 'volume_reset',     name: 'Reset Volume', service: 'Switch', momentary: true },
];

export default class ElsPetLitterBoxAccessory extends BaseAccessory {

  requiredSchema() {
    // SwitchAccessory requires switch/switch_1  [oai_citation:0‡SwitchAccessory.ts.txt](sediment://file_0000000023ec722f8e93b0ff49a258e1)
    // This device uses switch1  [oai_citation:1‡cat-toilet.json](sediment://file_00000000900071f5b0fe9f59b7575e9b)
    return [['switch1']];
  }

  configureServices() {
    // Remove old single-service artifacts (same pattern as SwitchAccessory)  [oai_citation:2‡SwitchAccessory.ts.txt](sediment://file_0000000023ec722f8e93b0ff49a258e1)
    const oldSwitch = this.accessory.getService(this.Service.Switch);
    if (oldSwitch && oldSwitch?.subtype === undefined) {
      this.platform.log.warn('Remove old service:', oldSwitch.UUID);
      this.accessory.removeService(oldSwitch);
    }

    for (const dp of DPS) {
      const schema = this.getSchema(dp.code);
      if (!schema || schema.type !== TuyaDeviceSchemaType.Boolean) {
        continue;
      }

      if (dp.momentary) {
        this.configureMomentary(schema, dp.name);
      } else {
        this.configureBoolean(schema, dp.name, dp.service);
      }
    }
  }

  private configureBoolean(schema: TuyaDeviceSchema, name: string, serviceType: 'Switch' | 'Lightbulb') {
    const serviceCtor = (serviceType === 'Lightbulb') ? this.Service.Lightbulb : this.Service.Switch;

    const service = this.accessory.getService(schema.code)
      || this.accessory.addService(serviceCtor, name, schema.code);

    configureName(this, service, name);
    configureOn(this, service, schema);
  }

  private configureMomentary(schema: TuyaDeviceSchema, name: string) {
    const service = this.accessory.getService(schema.code)
      || this.accessory.addService(this.Service.Switch, name, schema.code);

    configureName(this, service, name);

    service.getCharacteristic(this.Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (value !== true) return;

        this.checkOnlineStatus();

        // Send "true" trigger; use debounce queue like other codepaths  [oai_citation:3‡BaseAccessory.ts.txt](sediment://file_000000009b14722f801df0f5dcbe38b0)
        await this.sendCommands([{ code: schema.code, value: true } as any], true);

        // Reset HomeKit switch back to OFF so it can be pressed again
        setTimeout(() => {
          try {
            service.updateCharacteristic(this.Characteristic.On, false);
          } catch {}
        }, 750);

        // If the device only triggers on edge (false->true), you may need this:
        // setTimeout(async () => {
        //   try { await this.sendCommands([{ code: schema.code, value: false } as any], true); } catch {}
        // }, 1200);
      });
  }
}
