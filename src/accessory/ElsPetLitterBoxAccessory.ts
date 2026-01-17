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
  { code: 'lightloop_switch', name: 'Litter Box Door Light',   service: 'Switch' },
  { code: 'deodorize',        name: 'Deodorize the Litter Box',    service: 'Switch' },
  { code: 'UV_autoswitch',    name: 'Litter Box UV Light',      service: 'Switch' },
  { code: 'sleepmode_switch', name: 'Sleep Mode',   service: 'Switch' },

  // “Buttons”
  { code: 'manual',           name: 'Clean the Litter Boxw',    service: 'Switch', momentary: true },
  { code: 'reset',            name: 'Factory Reset',        service: 'Switch', momentary: true },

  // write-only; expose if schema exists
  { code: 'volume_reset',     name: 'Litter Added', service: 'Switch', momentary: true },
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

    this.configureBoolAsContactSensor('UV_working_state', 'UV Active');
    this.configureBoolAsContactSensor('deodorization_state', 'Deodorizing');
    this.configureDurationSetting('UV_time', 'UV Duration (s)');
    this.configureDurationSetting('clean_wait_time', 'Clean Delay (s)');
    this.configureDurationSetting('deodorize_time', 'Deodorize Duration (s)');
    this.configureAlarmFaultSensor();
    this.configureAlarmTypeSensors();
    this.configureUseCountSensor();
    this.configureBinFullnessAsFilter();
    this.configureStateAsContactSensor('cleaning', 'Cleaning');
    this.configureStateAsContactSensor('sleeping', 'Sleeping');
    this.configureStateAsContactSensor('caking', 'Cat Inside');
    this.configureStateAsOccupancySensor('caking', 'Cat Inside', 'state_caking_occ');
  }

  private scopedName(child: string) {
    const base = this.accessory.displayName?.trim() || 'Litter Box';
    return `${base} – ${child}`;
  }

  private configureStateAsOccupancySensor(stateValue: string, name: string, subtype: string) {
    const schema = this.getSchema('state');
    if (!schema || schema.type !== TuyaDeviceSchemaType.Enum) return;

    const service =
      this.accessory.getService(subtype) ||
      this.accessory.addService(this.Service.OccupancySensor, name, subtype);

    // configureName(this, service, this.scopedName(name));
    configureName(this, service, name);

    service.getCharacteristic(this.Characteristic.OccupancyDetected)
      .onGet(() => {
        const s = String(this.getStatus('state')?.value ?? '');
        const active = (s === stateValue);
        return active
          ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
      });
  }

  private configureUseCountSensor() {
    const schema = this.getSchema('clean_count');
    if (!schema || schema.type !== TuyaDeviceSchemaType.Integer) return;

    const service =
      this.accessory.getService('clean_count') ||
      this.accessory.addService(this.Service.LightSensor, 'Use Count', 'clean_count');

    // configureName(this, service, this.scopedName('Use Count'));
    configureName(this, service, 'Use Count');

    service.getCharacteristic(this.Characteristic.CurrentAmbientLightLevel)
      .onGet(() => {
        const n = Number(this.getStatus('clean_count')?.value ?? 0);
        return Math.max(0.0001, n); // HomeKit requires >= 0.0001
      });
  }

  private configureStateAsContactSensor(stateValue: string, name: string) {
    const schema = this.getSchema('state');
    if (!schema || schema.type !== TuyaDeviceSchemaType.Enum) return;

    const subtype = `state_${stateValue}`;

    const service =
      this.accessory.getService(subtype) ||
      this.accessory.addService(this.Service.ContactSensor, name, subtype);

    configureName(this, service, name);

    service.getCharacteristic(this.Characteristic.ContactSensorState)
      .onGet(() => {
        const s = String(this.getStatus('state')?.value ?? '');
        const active = (s === stateValue);
        return active
          ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
      });
  }

  private configureBinFullnessAsFilter() {
    const schema = this.getSchema('volume');
    if (!schema || schema.type !== TuyaDeviceSchemaType.Enum) return;

    const service =
      this.accessory.getService('volume') ||
      this.accessory.addService(this.Service.FilterMaintenance, 'Waste Bin', 'volume');

    // configureName(this, service, this.scopedName('Waste Bin'));
    configureName(this, service, 'Waste Bin');

    const { FILTER_OK, CHANGE_FILTER } = this.Characteristic.FilterChangeIndication;

    service.getCharacteristic(this.Characteristic.FilterLifeLevel)
      .onGet(() => {
        const v = String(this.getStatus('volume')?.value ?? '');
        if (v === 'empty') return 100;
        if (v === 'half') return 50;
        if (v === 'full') return 0;
        return 100;
      });

    service.getCharacteristic(this.Characteristic.FilterChangeIndication)
      .onGet(() => {
        const v = String(this.getStatus('volume')?.value ?? '');
        return (v === 'full') ? CHANGE_FILTER : FILTER_OK;
      });

    // Optional: if you want a “reset” button in Home app
    if (this.getSchema('volume_reset')) {
      service.getCharacteristic(this.Characteristic.ResetFilterIndication)
        .onSet(async (value) => {
          if (value !== 1) return;
          this.checkOnlineStatus();
          await this.sendCommands([{ code: 'volume_reset', value: true } as any], true);
        });
    }
  }

  private configureBoolAsContactSensor(dpCode: string, name: string) {
    const schema = this.getSchema(dpCode);
    if (!schema || schema.type !== TuyaDeviceSchemaType.Boolean) return;

    const service =
      this.accessory.getService(dpCode) ||
      this.accessory.addService(this.Service.ContactSensor, name, dpCode);

    configureName(this, service, name);

    service.getCharacteristic(this.Characteristic.ContactSensorState)
      .onGet(() => {
        const v = !!this.getStatus(dpCode)?.value;
        // CONTACT_NOT_DETECTED = Open, CONTACT_DETECTED = Closed
        return v
          ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
      });
  }

  private configureAlarmFaultSensor() {
    const schema = this.getSchema('alarm');
    if (!schema || schema.code !== 'alarm') return;

    const service =
      this.accessory.getService('alarm_fault') ||
      this.accessory.addService(this.Service.ContactSensor, 'Fault', 'alarm_fault');

    // configureName(this, service, this.scopedName('Fault'));
    configureName(this, service, 'Fault');

    service.getCharacteristic(this.Characteristic.ContactSensorState)
      .onGet(() => {
        const n = Number(this.getStatus('alarm')?.value ?? 0);
        return (n !== 0)
          ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED // OPEN = fault
          : this.Characteristic.ContactSensorState.CONTACT_DETECTED;    // CLOSED = OK
      });
  }

  private configureAlarmTypeSensors() {
    if (!this.getSchema('alarm')) return;

    const stuckSvc =
      this.accessory.getService('alarm_stuck') ||
      this.accessory.addService(this.Service.ContactSensor, 'Fault: Stuck', 'alarm_stuck');

    const dislocSvc =
      this.accessory.getService('alarm_dislocation') ||
      this.accessory.addService(this.Service.ContactSensor, 'Fault: Dislocation', 'alarm_dislocation');

    configureName(this, stuckSvc, 'Fault: Stuck');
    configureName(this, dislocSvc, 'Fault: Dislocation');

    stuckSvc.getCharacteristic(this.Characteristic.ContactSensorState).onGet(() => {
      const n = Number(this.getStatus('alarm')?.value ?? 0);
      const active = (n & 0x01) !== 0;
      return active
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
    });

    dislocSvc.getCharacteristic(this.Characteristic.ContactSensorState).onGet(() => {
      const n = Number(this.getStatus('alarm')?.value ?? 0);
      const active = (n & 0x02) !== 0;
      return active
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
    });
  }

  private configureDurationSetting(dpCode: string, name: string) {
    const schema = this.getSchema(dpCode);
    if (!schema || schema.type !== TuyaDeviceSchemaType.Integer) return;

    const service =
      this.accessory.getService(dpCode) ||
      this.accessory.addService(this.Service.Valve, name, dpCode);

    // configureName(this, service, this.scopedName(name));
    configureName(this, service, name);

    service.setCharacteristic(this.Characteristic.ValveType, this.Characteristic.ValveType.GENERIC_VALVE);

    // Keep the "valve" itself visually inactive; we only use SetDuration as a setting UI.
    service.getCharacteristic(this.Characteristic.Active)
      .onGet(() => this.Characteristic.Active.INACTIVE)
      .onSet(() => { /* ignore */ });

//    service.getCharacteristic(this.Characteristic.SetDuration)
//      .onGet(() => Number(this.getStatus(dpCode)?.value ?? 0))
//      .onSet(async (value) => {
//        this.checkOnlineStatus(); // BaseAccessory throws proper HAP error when offline  [oai_citation:9‡BaseAccessory.ts.txt](sediment://file_000000009b14722f801df0f5dcbe38b0)
//
//        const prop = schema.property as any;
//        const min = Number(prop?.min ?? 0);
//        const max = Number(prop?.max ?? value);
//        const step = Number(prop?.step ?? 1);
//
//        const v = Number(value);
//        const clamped = Math.max(min, Math.min(max, v));
//        const quantized = min + Math.round((clamped - min) / step) * step;
//
//        await this.sendCommands([{ code: dpCode, value: quantized } as any], true);
//      });
    const prop = schema.property as any;
    const min = Number(prop?.min ?? 0);
    //
    // In case schema.property.max fails to parse restrict it to a default of 1800 seconds
    const defaultMax = (dpCode === 'UV_time' || dpCode === 'deodorize_time' || dpCode === 'clean_wait_time') ? 1800 : 3600;
    const max = Number(prop?.max ?? defaultMax);
    const step = Number(prop?.step ?? 1);

    const ch = service.getCharacteristic(this.Characteristic.SetDuration);

    // Tell clients (EG: Eve) the legal range/step
    ch.setProps({
      minValue: min,
      maxValue: max,
      minStep: step,
    });

  const readCurrent = () => {
    const raw = Number(this.getStatus(dpCode)?.value);
    const v = Number.isFinite(raw) ? raw : min;

    const clamped = Math.max(min, Math.min(max, v));
    const quantized = min + Math.round((clamped - min) / step) * step;

    return quantized;
  };

  // Set an initial legal value immediately (prevents startup warnings)
  try { ch.updateValue(readCurrent()); } catch {}

  ch.onGet(() => readCurrent())
    .onSet(async (value) => {
      this.checkOnlineStatus();

      const v = Number(value);
      const clamped = Math.max(min, Math.min(max, v));
      const quantized = min + Math.round((clamped - min) / step) * step;

      await this.sendCommands([{ code: dpCode, value: quantized } as any], true);
    });
  }

  private configureBoolean(schema: TuyaDeviceSchema, name: string, serviceType: 'Switch' | 'Lightbulb') {
    const serviceCtor = (serviceType === 'Lightbulb') ? this.Service.Lightbulb : this.Service.Switch;

    const service = this.accessory.getService(schema.code)
      || this.accessory.addService(serviceCtor, name, schema.code);

    // configureName(this, service, this.scopedName(name));
    configureName(this, service, name);
    configureOn(this, service, schema);
  }

  private configureMomentary(schema: TuyaDeviceSchema, name: string) {
    const service = this.accessory.getService(schema.code)
      || this.accessory.addService(this.Service.Switch, name, schema.code);

    // configureName(this, service, this.scopedName(name));
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
