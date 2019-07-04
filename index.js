/* jshint node: true */
"use strict";
var Service;
var Characteristic;
var DoorState;
var TargetState;
var HAPServerStatus;
var rpio = require('rpio');
        
module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;
  TargetState = homebridge.hap.Characteristic.TargetDoorState;
  HAPServerStatus = homebridge.hap.HAPServer.Status;

  homebridge.registerAccessory("homebridge-rpi-garage-door-opener", "RaspPiGPIOGarageDoor", RaspPiGPIOGarageDoorAccessory);
};

function RaspPiGPIOGarageDoorAccessory(log, config) {
  this.log = log;
  this.version = require('./package.json').version;
  log("RaspPiGPIOGarageDoorAccessory version " + this.version);

  this.name = config["name"];

  this.doorSwitchPin = config["doorSwitchPin"];
  this.relayOn = config["doorSwitchValue"];
  this.doorSwitchPressTimeInMs = (config["doorSwitchPressTime"] || 0.5) * 1000;
  this.relayIdleInMs = (config["doorSwitchIdleTime"] || 0.5) * 1000;
  this.hasRelay = (this.doorSwitchPin !== undefined && this.relayOn !== undefined);
  if (!this.hasRelay) {
    log("ERROR! No RELAY. Configuration is not supported.");
  } else {
    this.relayOff = 1 - this.relayOn; //opposite of relayOn (O/1)
    rpio.open(this.doorSwitchPin, rpio.OUTPUT, this.relayOff);
    log("Door switch pin: " + this.doorSwitchPin);
    log("Door switch val: " + this.pinValueToString(this.relayOn));
    log("Door switch press time in ms: " + this.doorSwitchPressTimeInMs);
    log("Door switch idle time in ms: " + this.relayIdleInMs);
  }

  this.closedDoorSensorPin = config["closedDoorSensorPin"];
  this.closedDoorSensorValue = config["closedDoorSensorValue"] || 0;
  this.closedDoorResistor = config["closedDoorResistor"] || 0;
  this.hasClosedSensor = (this.closedDoorSensorPin !== undefined);
  if (!this.hasClosedSensor) {
    log("ERROR! No CLOSED SENSOR. Configuration is not supported.");
  } else {
    rpio.open(this.closedDoorSensorPin, rpio.INPUT, this.closedDoorResistor);
    log("Door closed sensor: Configured");
    log("    Door closed sensor pin: " + this.closedDoorSensorPin);
    log("    Door closed sensor val: " + this.pinValueToString(this.closedDoorSensorValue));  
    log("    Door closed resistor: " + this.internalResistorToString(this.closedDoorResistor));  
  }
  this.openDoorSensorPin = config["openDoorSensorPin"];
  this.openDoorSensorValue = config["openDoorSensorValue"] || 0;
  this.openDoorResistor = config["openDoorResistor"] || 0;
  this.hasOpenSensor = (this.openDoorSensorPin !== undefined);
  if (!this.hasOpenSensor) {
    log("ERROR! No OPEN SENSOR. Configuration is not supported.");
  } else {
    rpio.open(this.openDoorSensorPin, rpio.INPUT, this.openDoorResistor);
    log("Door open sensor: Configured");
    log("    Door open sensor pin: " + this.openDoorSensorPin);
    log("    Door open sensor val: " + this.pinValueToString(this.openDoorSensorValue));
    log("    Door open resistor: " + this.internalResistorToString(this.openDoorResistor));
  }
  this.hasBothSensors = this.hasClosedSensor && this.hasOpenSensor;

  this.sensorPollInMs = (config["doorPollTime"] || 1) * 1000;
  log("Sensor poll in ms: " + this.sensorPollInMs);
  this.doorOpensInMs = (config["doorOpenTime"] || 15) * 1000;
  log("Door opens in ms: " + this.doorOpensInMs);

  this.cachedSensorState = this.hasBothSensors ? this.determineCurrentDoorState() : DoorState.CLOSED;
  this.log("Initial door state: " + this.doorStateToString(this.cachedSensorState));

  this.canActivateRelay = true;
  this.canRetry = false;
  this.watchdog = null;

  if (!this.hasRelay || !this.hasBothSensors) {
    this.log("ERROR! THE PLUGIN WILL NOT WORK AS EXPECTED. IT WILL RETURN COMMUNICATION ERRORS.");
  }
}

RaspPiGPIOGarageDoorAccessory.prototype = {

  getServices: function() {
    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Opensource Community")
      .setCharacteristic(Characteristic.Model, "RaspPi GPIO GarageDoor")
      .setCharacteristic(Characteristic.SerialNumber, "0")
      .setCharacteristic(Characteristic.FirmwareRevision, this.version);

    this.openerService = new Service.GarageDoorOpener(this.name,this.name);

    this.currentDoorState = this.openerService.getCharacteristic(Characteristic.CurrentDoorState);
    this.targetDoorState = this.openerService.getCharacteristic(Characteristic.TargetDoorState);

    if (this.hasBothSensors)
      setInterval(this.monitorDoorState.bind(this), this.sensorPollInMs);
    else
      this.currentDoorState.on('get',this.getCurrentStateError.bind(this));

    this.currentDoorState.on('change',this.currentStateChange.bind(this));

    if (this.hasRelay && this.hasBothSensors)
      this.targetDoorState.on('set', this.setTargetState.bind(this));
    else
      this.targetDoorState.on('set', this.setTargetStateError.bind(this));

    this.currentDoorState.updateValue(this.cachedSensorState);
    this.targetDoorState.updateValue(this.cachedSensorState === DoorState.CLOSED ? TargetState.CLOSED : TargetState.OPEN);
    
    this.controlService = new Service.Switch("Garage Door Control");
    this.doorControlState = this.controlService.getCharacteristic(Characteristic.On);
    this.doorControlState.on('set', this.setControlState.bind(this));

    return [this.infoService, this.openerService, this.controlService];
  },

  setTargetStateError: function(target, callback) {
    callback(new Error(HAPServerStatus.SERVICE_COMMUNICATION_FAILURE));
  },

  getCurrentStateError: function(callback) {
    callback(new Error(HAPServerStatus.SERVICE_COMMUNICATION_FAILURE));
  },

  setTargetState: function(target, callback) {
    let error = null;
    const state = this.currentDoorState.value;
    if (!(target === state || (target === TargetState.CLOSED && state === DoorState.CLOSING) || (target === TargetState.OPEN && state === DoorState.OPENING))){
      this.log("Setting target state to " + this.targetDoorStateToString(target));
      if (this.turnRelayOn((state === DoorState.CLOSING || state === DoorState.OPENING) ? 2 : 1)) {
        this.canRetry = (state !== DoorState.CLOSED && state !== DoorState.OPEN);
        if (state !== DoorState.CLOSED && state !== DoorState.OPEN)
          this.currentDoorState.updateValue(target === TargetState.CLOSED ? DoorState.CLOSING : DoorState.OPENING);
      } else {
        this.log("Unable to " + this.targetDoorStateToString(target) + " the door while relay is operating");
        error = new Error(HAPServerStatus.RESOURCE_BUSY);
      } 
    }
    callback(error);
  },

  currentStateChange: function(state) {
    this.log("State changed from " + this.doorStateToString(state.oldValue) + " to " + this.doorStateToString(state.newValue));
    const target = this.targetDoorState.value;
    clearTimeout(this.watchdog);
    switch (state.newValue) {
      case DoorState.CLOSED:
      case DoorState.OPEN:
        if (target !== state.newValue) {
          if (this.canRetry) {
            this.log("Trying again to " + this.targetDoorStateToString(target) + " the door");
            this.turnRelayOn();
          } else
            this.targetDoorState.updateValue(state.newValue);
        }
        this.canRetry = false;
        break;
      case DoorState.CLOSING:
        this.watchdog = setTimeout(this.setStateToStopped.bind(this),this.doorOpensInMs);
        this.targetDoorState.updateValue(TargetState.CLOSED);
        break;
      case DoorState.OPENING:
        this.watchdog = setTimeout(this.setStateToStopped.bind(this),this.doorOpensInMs);
        this.targetDoorState.updateValue(TargetState.OPEN);
        break;
      case DoorState.STOPPED:
        this.targetDoorState.updateValue(TargetState.OPEN);
        this.canRetry = false;
        break;
      default:
    }
  },

  setStateToStopped: function() {
    this.currentDoorState.updateValue(DoorState.STOPPED);
  },

  monitorDoorState: function() {
    let state, sensorState;
    state = sensorState = this.determineCurrentDoorState();
    if (this.cachedSensorState !== sensorState) {
      if (state === DoorState.STOPPED)
        state = (this.cachedSensorState === DoorState.CLOSED ? DoorState.OPENING : DoorState.CLOSING);
      this.currentDoorState.updateValue(state);
      this.cachedSensorState = sensorState;
    }
  },

  determineCurrentDoorState: function() {
    if (rpio.read(this.closedDoorSensorPin) === this.closedDoorSensorValue)
      return DoorState.CLOSED;
    else
      return rpio.read(this.openDoorSensorPin) === this.openDoorSensorValue ? DoorState.OPEN : DoorState.STOPPED;
  },

  setControlState: function(target, callback) {
    this.log("Turning control switch " + (target ? "ON" : "OFF"));
    if (target) {
      this.turnRelayOn();
      setTimeout(function() {
        this.doorControlState.updateValue(false);
      }.bind(this), this.doorSwitchPressTimeInMs);
    }
    callback();
  },

  turnRelayOn: function(count = 1) {
    const ok = this.canActivateRelay;
    if (ok && count > 0) {
      this.log("Turning on door relay, pin " + this.doorSwitchPin + " = " + this.relayOn);
      this.canActivateRelay = false;
      rpio.write(this.doorSwitchPin, this.relayOn);
      setTimeout(this.turnRelayOff.bind(this), this.doorSwitchPressTimeInMs, --count);
    }
    return ok;
  },

  turnRelayOff: function(...args) {
    this.log("Turning off door relay, pin " + this.doorSwitchPin + " = " + this.relayOff);
    rpio.write(this.doorSwitchPin, this.relayOff);
    setTimeout(this.okToUseRelay.bind(this), this.relayIdleInMs, ...args);
  },

  okToUseRelay: function(...args) {
    this.log("Relay available");
    this.canActivateRelay = true;
    this.targetDoorState.updateValue(this.targetDoorState.value);
    this.turnRelayOn(...args);
  },

  targetDoorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSE";
      default:
        return "UNKNOWN (" + state + ")";
    }
  },

  doorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSED";
      case DoorState.STOPPED:
        return "STOPPED";
      case DoorState.OPENING:
        return "OPENING";
      case DoorState.CLOSING:
        return "CLOSING";
      default:
        return "UNKNOWN (" + state + ")";
    }
  },

  pinValueToString: function(value) {
    switch (value) {
      case 0:
        return "Active Low";
      case 1:
        return "Active High";
      default:
        return "UNDEFINED (" + value + ")";
    }
  },
  
  internalResistorToString: function(state) {
    switch (state) {
      case rpio.PULL_OFF:
        return "Disabled";
      case rpio.PULL_DOWN:
        return "Pull Down";
      case rpio.PULL_UP:
        return "Pull Up";
      default:
        return "UNDEFINED (" + state + ")";
    }
  }
  
};
