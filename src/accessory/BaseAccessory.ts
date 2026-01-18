/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PlatformAccessory, Service, Characteristic, Nullable, CharacteristicValue } from 'homebridge';

import  debounce  from 'debounce';

import createWifiRSSICharacteristic from './characteristic/WifiRSSI';
import createWifiSignalLevelCharacteristic from './characteristic/WifiSignalLevel';

import { isDeepStrictEqual } from 'node:util';

import { TuyaDeviceSchema, TuyaDeviceSchemaIntegerProperty, TuyaDeviceSchemaMode, TuyaDeviceStatus } from '../device/TuyaDevice';
import { TuyaPlatform } from '../platform';
import { limit } from '../util/util';
import { PrefixLogger } from '../util/Logger';

// Homebridge's `WithUUID` type is not always exported; define a minimal local version.
type WithUUID<T> = T & { UUID: string };

const MANUFACTURER = 'Tuya Inc.';

const SCHEMA_CODE = {
  BATTERY_STATE: ['battery_state'],
  BATTERY_PERCENT: ['battery_percentage', 'residual_electricity', 'wireless_electricity', 'va_battery', 'battery'],
  BATTERY_CHARGING: ['charge_state'],
};


/**
 * Homebridge Accessory Categories Documentation:
 *   https://developers.homebridge.io/#/categories
 * Tuya Standard Instruction Set Documentation:
 *   https://developer.tuya.com/en/docs/iot/standarddescription?id=K9i5ql6waswzq
 */
class BaseAccessory {
  public readonly Service: typeof Service = this.platform.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.platform.api.hap.Characteristic;

  public deviceManager = this.platform.deviceManager!;
  public device = this.deviceManager.getDevice(this.accessory.context.deviceID)!;
  public log = new PrefixLogger(
    this.platform.log,
    this.device.name.length > 0 ? this.device.name : this.device.id,
    this.platform.options.debug && ((this.platform.options.debugLevel ?? '').length > 0
      ? this.platform.options.debugLevel?.includes(this.device.id)
      : true),
  );

  public intialized = false;

  public adaptiveLightingController?;
    
  private wifiInfoAttached = false;
  private static wifiCharsRegistered = false;
  
  protected maybeAttachWifiInfo(service: Service) {
    if (this.wifiInfoAttached) return;
        
    // Never attach to AccessoryInformation
    if (service.UUID === this.Service.AccessoryInformation.UUID) return;
    if (service.UUID === this.Service.Battery.UUID) return;

        
    // Only attach to “primary” services (no subtype)
    // This avoids DP sub-services like switch_inching, litterbox sub-switches, etc.
    if ((service as any).subtype !== undefined) return;
        
    this.addWifiInfoCharacteristicsToService(service);
    this.wifiInfoAttached = true;
  }
    
  protected attachWifiInfoFallbackIfNeeded() {
    if (this.wifiInfoAttached) return;

    const svc = this.accessory.services.find(s =>
      s.UUID !== this.Service.AccessoryInformation.UUID &&
      s.UUID !== this.Service.Battery.UUID
    );

    if (svc) {
      this.addWifiInfoCharacteristicsToService(svc);
      this.wifiInfoAttached = true;
    }
  }

  private ensureWifiCharacteristicsRegistered() {
    if (BaseAccessory.wifiCharsRegistered) {
      return;
    }

    const hapChar: any = this.platform.api.hap.Characteristic as any;

    if (!hapChar.WifiRSSI) {
      hapChar.WifiRSSI = createWifiRSSICharacteristic(this.platform.api);
    }
    if (!hapChar.WifiSignalLevel) {
      hapChar.WifiSignalLevel = createWifiSignalLevelCharacteristic(this.platform.api);
    }

    BaseAccessory.wifiCharsRegistered = true;
  }

  private translateWifiSignalLevel(level: unknown): string {
    if (typeof level !== 'string') {
      return 'Unknown';
    }

    // Tuya commonly returns Chinese values
    const map: Record<string, string> = {
      '优': 'Excellent',
      '优秀': 'Very Good',
      '良': 'Good',
      '一般': 'Fair',
      '差': 'Poor',
    };

    return map[level] ?? level;
  }


  constructor(
    public readonly platform: TuyaPlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    this.addAccessoryInfoService();
    this.addBatteryService();
  }

  addAccessoryInfoService() {
    const service = this.accessory.getService(this.Service.AccessoryInformation)
      || this.accessory.addService(this.Service.AccessoryInformation);

    service
      .setCharacteristic(this.Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(this.Characteristic.Model, this.device.product_id)
      .setCharacteristic(this.Characteristic.Name, this.device.name)
      .setCharacteristic(this.Characteristic.ConfiguredName, this.device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, this.device.uuid)
    ;
  }

  private addWifiInfoCharacteristicsToService(service: Service) {
    
      // Skip non-visible or unhelpful services
      if (service.UUID === this.Service.AccessoryInformation.UUID) return;
      if (service.UUID === this.Service.BatteryService.UUID) return;

      this.ensureWifiCharacteristicsRegistered();

      const hapChar: any = this.platform.api.hap.Characteristic as any;

      if (!service.testCharacteristic(hapChar.WifiRSSI)) {
        service.addOptionalCharacteristic(hapChar.WifiRSSI);
      }
      if (!service.testCharacteristic(hapChar.WifiSignalLevel)) {
        service.addOptionalCharacteristic(hapChar.WifiSignalLevel);
      }

      service.getCharacteristic(hapChar.WifiRSSI).onGet(() => {
        const d: any = this.device as any;
        const extra = d?.extra ?? {};
        // accept multiple possible storage keys
        const v = extra.wifiRssi ?? extra.wifi_rssi ?? extra.wifi?.rssi ?? extra.wifiSignal?.signal;
        return (typeof v === 'number') ? v : -100;
      });

      service.getCharacteristic(hapChar.WifiSignalLevel).onGet(() => {
        const d: any = this.device as any;
        const extra = d?.extra ?? {};
        const raw = extra.wifiSignalLevelEn ?? extra.wifiSignalLevelRaw ?? extra.wifi?.level ?? extra.wifiSignal?.signalLevel;
        return this.translateWifiSignalLevel(raw);
       
      });
    
  }


  addBatteryService() {
    const percentSchema = this.getSchema(...SCHEMA_CODE.BATTERY_PERCENT);
    if (!percentSchema) {
      return;
    }

    const { BATTERY_LEVEL_NORMAL, BATTERY_LEVEL_LOW } = this.Characteristic.StatusLowBattery;
    const service = this.accessory.getService(this.Service.Battery)
      || this.accessory.addService(this.Service.Battery);

    const stateSchema = this.getSchema(...SCHEMA_CODE.BATTERY_STATE);
    if (stateSchema || percentSchema) {
      service.getCharacteristic(this.Characteristic.StatusLowBattery)
        .onGet(() => {
          if (stateSchema) {
            const status = this.getStatus(stateSchema.code)!;
            return (status!.value === 'low') ? BATTERY_LEVEL_LOW : BATTERY_LEVEL_NORMAL;
          }

          // fallback
          const status = this.getStatus(percentSchema.code)!;
          return (status!.value as number <= 20) ? BATTERY_LEVEL_LOW : BATTERY_LEVEL_NORMAL;
        });
    }

    const property = percentSchema.property as TuyaDeviceSchemaIntegerProperty;
    const multiple = Math.pow(10, property ? property.scale : 0);
    service.getCharacteristic(this.Characteristic.BatteryLevel)
      .onGet(() => {
        const status = this.getStatus(percentSchema.code)!;
        return limit(status.value as number / multiple, 0, 100);
      });

    const chargingSchema = this.getSchema(...SCHEMA_CODE.BATTERY_CHARGING);
    if (chargingSchema) {
      const { NOT_CHARGING, CHARGING } = this.Characteristic.ChargingState;
      service.getCharacteristic(this.Characteristic.ChargingState)
        .onGet(() => {
          const status = this.getStatus(chargingSchema.code)!;
          return (status.value as boolean) ? CHARGING : NOT_CHARGING;
        });
    }
  }
    
  configureServices() {
        //
  }
    
  getOrAddService(serviceType: WithUUID<typeof Service>, name?: string, subtype?: string) {
    let service = this.accessory.getServiceById(serviceType, subtype ?? '');

    if (!service) {
      const effectiveSubtype = subtype ?? '';
      service = this.accessory.addService(serviceType, name ?? this.device.name, effectiveSubtype);
    }

    if (name) {
      service.setCharacteristic(this.Characteristic.Name, name);
    }

    // Attach wifi info once, to the primary service only.
    this.maybeAttachWifiInfo(service);

    return service;
  }

  configureStatusActive() {
    for (const service of this.accessory.services) {
      if (!service.testCharacteristic(this.Characteristic.StatusActive)) { // silence warning
        service.addOptionalCharacteristic(this.Characteristic.StatusActive);
      }

      service.getCharacteristic(this.Characteristic.StatusActive)
        .onGet(() => this.device.online);

      this.maybeAttachWifiInfo(service);
    }
    this.attachWifiInfoFallbackIfNeeded();
  }

  async updateAllValues() {
    for (const service of this.accessory.services) {
      
      for (const characteristic of service.characteristics) {
        if (characteristic.UUID === this.Characteristic.ProgrammableSwitchEvent.UUID) {
          continue;
        }

        let newValue: Nullable<CharacteristicValue> | Error = characteristic.value;
        const getHandler = characteristic['getHandler'];
        if (getHandler) {
          try {
            newValue = await getHandler();
          } catch (err: any) {
            // Some get handlers intentionally throw HapStatusError (e.g., device offline).
            // During internal polling, treat that as a characteristic error instead of crashing the child bridge.
            newValue = (err instanceof Error) ? err : new Error(String(err));
            this.log.debug(
              '[%s/%s/%s] Get handler threw: %s',
              service.constructor.name,
              service.subtype,
              characteristic.constructor.name,
              (newValue as Error).message,
            );
          }
        }

        if (characteristic.value !== newValue && !(newValue instanceof Error)) {
          this.log.debug(
            '[%s/%s/%s] Update value: %o => %o',
            service.constructor.name,
            service.subtype,
            characteristic.constructor.name,
            characteristic.value,
            newValue,
          );
        }
        characteristic.updateValue(newValue);
      }
    }
  }

  checkOnlineStatus() {
    if (!this.device.online) {
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getSchema(...codes: string[]) {
    for (const code of codes) {
      const schema = this.device.schema.find(schema => schema.code === code);
      if (!schema) {
        continue;
      }

      // Readable schema must have a status
      if ([TuyaDeviceSchemaMode.READ_WRITE, TuyaDeviceSchemaMode.READ_ONLY].includes(schema.mode)
        && !this.getStatus(schema.code)) {
        continue;
      }

      return schema;
    }
    return undefined;
  }

  getStatus(code: string) {
    return this.device.status.find(status => status.code === code);
  }

  private sendQueue = new Map<string, TuyaDeviceStatus>();
  private debounceSendCommands = debounce(async () => {
    const commands = [...this.sendQueue.values()];
    if (commands.length === 0) {
      return;
    }
    await this.deviceManager.sendCommands(this.device.id, commands);
    this.sendQueue.clear();
  }, 100);

  async sendCommands(commands: TuyaDeviceStatus[], debounce = false) {
    if (commands.length === 0) {
      return;
    }

    commands = commands.filter((status) => status.code && status.value !== undefined);

    if (this.device.online === false) {
      this.log.warn('Device is offline, skip send command.');
      this.updateAllValues();
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      return;
    }

    // Update cache immediately
    for (const newStatus of commands) {
      const oldStatus = this.device.status.find(_status => _status.code === newStatus.code);
      if (oldStatus) {
        oldStatus.value = newStatus.value;
      }
    }

    if (debounce === false) {
      return await this.deviceManager.sendCommands(this.device.id, commands);
    }

    for (const newStatus of commands) {
      // Update send queue
      this.sendQueue.set(newStatus.code, newStatus);
    }

    this.debounceSendCommands();
  }

  checkRequirements() {
    let result = true;
    for (const codes of this.requiredSchema()) {
      const schema = this.getSchema(...codes);
      if (schema) {
        continue;
      }
      this.log.warn('Product Category: %s', this.device.category);
      this.log.warn('Missing one of the required schema: %s', codes);
      this.log.warn('Please switch device control mode to "DP Insctrution", and set `deviceOverrides` manually.');
      this.log.warn('Detail information: https://github.com/0x5e/homebridge-tuya-platform#faq');
      result = false;
    }

    if (!result) {
      this.log.warn('Existing schema: %o', this.device.schema);
    }

    return result;
  }

  requiredSchema(): string[][] {
    return [];
  }

  async onDeviceInfoUpdate(info) {
    this.updateAllValues();
  }

  async onDeviceStatusUpdate(status: TuyaDeviceStatus[]) {
    this.updateAllValues();
  }

}

// Overriding getSchema, getStatus, sendCommands
export default class OverridedBaseAccessory extends BaseAccessory {

  private eval = (script: string, device, value) => eval(script);

  private getOverridedSchema(code: string) {
    const schemaConfig = this.platform.getDeviceSchemaConfig(this.device, code);
    if (!schemaConfig) {
      return undefined;
    }

    const oldSchema = this.device.schema.find(schema => schema.code === schemaConfig.code);
    if (!oldSchema) {
      return undefined;
    }

    const schema = {
      code,
      mode: oldSchema.mode,
      type: schemaConfig.type || oldSchema.type,
      property: schemaConfig.property || oldSchema.property,
      _hidden: schemaConfig.hidden,
    } as TuyaDeviceSchema;

    if (!isDeepStrictEqual(oldSchema, schema)) {
      this.log.debug('Override schema %o => %o', oldSchema, schema);
    }

    return schema;
  }

  getSchema(...codes: string[]) {
    for (const code of codes) {
      const schema = this.getOverridedSchema(code) || super.getSchema(code);
      if (!schema) {
        continue;
      }
      if (schema['_hidden']) {
        return undefined;
      }
      return schema;
    }
    return undefined;
  }


  private getOverridedStatus(code: string) {
    const schemaConfig = this.platform.getDeviceSchemaConfig(this.device, code);
    if (!schemaConfig) {
      return undefined;
    }

    const oldStatus = super.getStatus(schemaConfig.code);
    if (!oldStatus) {
      return undefined;
    }

    const status = { code: schemaConfig.newCode || schemaConfig.code, value: oldStatus.value } as TuyaDeviceStatus;
    if (schemaConfig.onGet) {
      status.value = this.eval(schemaConfig.onGet, this.device, oldStatus.value);
    }

    if (!isDeepStrictEqual(oldStatus, status)) {
      this.log.debug('Override status %o => %o', oldStatus, status);
    }

    return status;
  }

  getStatus(code: string) {
    return this.getOverridedStatus(code) || super.getStatus(code);
  }


  async sendCommands(commands: TuyaDeviceStatus[], debounce?: boolean) {

    // convert to original commands
    for (const command of commands) {
      const schemaConfig = this.platform.getDeviceSchemaConfig(this.device, command.code);
      if (!schemaConfig) {
        continue;
      }

      const oldCommand = { code: schemaConfig.code, value: command.value } as TuyaDeviceStatus;
      if (schemaConfig.onSet) {
        oldCommand.value = this.eval(schemaConfig.onSet, this.device, command.value);
      }

      if (!isDeepStrictEqual(oldCommand, command)) {
        this.log.debug('Override command %o => %o', command, oldCommand);
        command.code = oldCommand.code;
        command.value = oldCommand.value;
      }
    }

    await super.sendCommands(commands, debounce);
  }
}
