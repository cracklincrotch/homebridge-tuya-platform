import { TuyaDeviceSchema, TuyaDeviceSchemaType } from '../device/TuyaDevice';
import BaseAccessory from './BaseAccessory';
import { configureName } from './characteristic/Name';
import { configureOn } from './characteristic/On';
import { configureEnergyUsage } from './characteristic/EnergyUsage';
import { configureCurrentTemperature } from './characteristic/CurrentTemperature';
import { configureCurrentRelativeHumidity } from './characteristic/CurrentRelativeHumidity';

const SCHEMA_CODE = {
  ON: ['switch', 'switch_1', 'switch_on'], // switch_2, switch_3, switch_4, ..., switch_usb1, switch_usb2, switch_usb3, ..., switch_backlight
  CURRENT: ['cur_current'],
  POWER: ['cur_power'],
  VOLTAGE: ['cur_voltage'],
  TOTAL_POWER: ['add_ele'],
  CURRENT_TEMP: ['va_temperature', 'temp_current'],
  CURRENT_HUMIDITY: ['va_humidity', 'humidity_value'],
  INCHING: ['switch_inching'],
};

export default class SwitchAccessory extends BaseAccessory {

  requiredSchema() {
    return [SCHEMA_CODE.ON];
  }

  configureServices() {

    const oldService = this.accessory.getService(this.mainService());
    if (oldService && oldService?.subtype === undefined) {
      this.platform.log.warn('Remove old service:', oldService.UUID);
      this.accessory.removeService(oldService);
    }

    const schemata = this.device.schema.filter(
      (schema) => schema.code.startsWith('switch') && schema.type === TuyaDeviceSchemaType.Boolean,
    );

    schemata.forEach((schema, index) => {
      const name = (schemata.length === 1) ? this.device.name : schema.code;
      this.configureSwitch(schema, name, index === 0);
    });

    // Other
    configureCurrentTemperature(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_TEMP));
    configureCurrentRelativeHumidity(this, undefined, this.getSchema(...SCHEMA_CODE.CURRENT_HUMIDITY));
    this.configureInching();
  }


  mainService() {
    return this.Service.Switch;
  }

  configureSwitch(schema: TuyaDeviceSchema, name: string, isPrimary: boolean) {
    const service = this.accessory.getService(schema.code)
      || this.accessory.addService(this.mainService(), name, schema.code);

    configureName(this, service, name);
    configureOn(this, service, schema);

    const cur = this.getSchema('cur_current');
    const vol = this.getSchema('cur_voltage');
    const pwr = this.getSchema('cur_power');
    const tot = this.getSchema('add_ele');

/*    this.platform.log.info(`[${this.device.name}] energy schema codes:`, {
      on: schema.code,
      cur_current: cur?.code,
      cur_voltage: vol?.code,
      cur_power: pwr?.code,
      add_ele: tot?.code,
    });

    this.platform.log.info(`[${this.device.name}] energy status values:`, {
      cur_current: this.getStatus('cur_current')?.value,
      cur_voltage: this.getStatus('cur_voltage')?.value,
      cur_power: this.getStatus('cur_power')?.value,
      add_ele: this.getStatus('add_ele')?.value,
    });
*/

    if (isPrimary) {
      const mkIntSchema = (code: string, unit: string, scale: number) => ({
        code,
        type: TuyaDeviceSchemaType.Integer,
        // "mode" exists on TuyaDeviceSchema; if TS complains, cast as any
        mode: 'ro',
        property: { unit, min: 0, max: 1000000, scale, step: 1 },
      } as any);

      const isCZ = this.device.category === 'cz';

      const voltageSchema =
        this.getSchema('cur_voltage')
        ?? (isCZ && this.getStatus('cur_voltage') ? mkIntSchema('cur_voltage', 'V', 1) : undefined);
     
       const currentSchema =
        this.getSchema('cur_current')
        ?? (isCZ && this.getStatus('cur_current') ? mkIntSchema('cur_current', 'mA', 0) : undefined);

      const powerSchema =
        this.getSchema('cur_power')
        ?? (isCZ && this.getStatus('cur_power') ? mkIntSchema('cur_power', 'W', 1) : undefined);       // /10

      const totalSchema =
        this.getSchema('add_ele')
        ?? (isCZ && this.getStatus('add_ele') ? mkIntSchema('add_ele', '度', 3) : undefined);          // /1000

      configureEnergyUsage(
        this.platform.api,
        this,
        service,
        currentSchema,
        powerSchema,
        voltageSchema,
        totalSchema,
      );

/*      this.platform.log.info(
        `[${this.device.name}] characteristics count=${service.characteristics.length} uuids=${service.characteristics.map(c => c.UUID).join(',')}`,
      );
*/
    }
  }

  configureInching() {
    const schema = this.getSchema(...SCHEMA_CODE.INCHING);
    if (!schema || schema.type !== TuyaDeviceSchemaType.String) {
      return;
    }

    const service = this.accessory.getService(schema.code)
      || this.accessory.addService(this.Service.Switch, schema.code, schema.code);

    configureName(this, service, schema.code);
    service.getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        this.checkOnlineStatus();
        const status = this.getStatus(schema.code)!;
        const buffer = Buffer.from(status.value as string, 'base64');
        return (buffer.length === 3) && (buffer[0] === 1);
      })
      .onSet(async value => {
        const status = this.getStatus(schema.code)!;
        let buffer = Buffer.from(status.value as string, 'base64');
        if (buffer.length !== 3) {
          buffer = Buffer.alloc(3);
        }
        buffer[0] = (value as boolean) ? 1 : 0;
        await this.sendCommands([{
          code: schema.code,
          value: buffer.toString('base64'),
        }], true);
      });
  }

}
