/* jshint node: true */
"use strict";
var Service;
var Characteristic;
var DoorState;
var HAPServerStatus;
var process = require('process');
var rpio = require('rpio');
        
module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;
  HAPServerStatus = homebridge.hap.HAPServer.Status;

  homebridge.registerAccessory("homebridge-rpi-garage-door-opener", "RaspPiGPIOGarageDoor", RaspPiGPIOGarageDoorAccessory);
};

function RaspPiGPIOGarageDoorAccessory(log, config) {
  this.log = log;
  this.version = require('./package.json').version;
  log("RaspPiGPIOGarageDoorAccessory version " + this.version);

  if (process.geteuid() !== 0) {
    log("WARN! WARN! WARN! may not be able to control GPIO pins because not running as root!");
  }

  this.name = config["name"];

  this.doorSwitchPin = config["doorSwitchPin"];
  this.relayOn = config["doorSwitchValue"];
  this.doorSwitchPressTimeInMs = (config["doorSwitchPressTime"] || 0.5) * 1000;
  this.relayIdleInMs = (config["doorSwitchIdleTime"] || 0.5) * 1000;
  this.hasRelay = true;
  if (this.doorSwitchPin === undefined || this.relayOn === undefined) {
    this.hasRelay = false;
    log("ERROR! No RELAY. Configuration is not supported.");
  } else {
    this.relayOff = 1-this.relayOn; //opposite of relayOn (O/1)
    rpio.open(this.doorSwitchPin, rpio.OUTPUT, this.relayOff);
    log("Door switch pin: " + this.doorSwitchPin);
    log("Door switch val: " + this.pinValueToString(this.relayOn));
    log("Door switch press time in ms: " + this.doorSwitchPressTimeInMs);
    log("Door switch idle time in ms: " + this.relayIdleInMs);
  }

  this.closedDoorSensorPin = config["closedDoorSensorPin"];
  this.closedDoorSensorValue = config["closedDoorSensorValue"] || 0;
  this.closedDoorResistor = config["closedDoorResistor"] || 0;
  this.hasSensors = true;
  if (!this.hasClosedSensor()) {
    this.hasSensors = false;
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
  if (!this.hasOpenSensor()) {
    this.hasSensors = false;
    log("ERROR! No OPEN SENSOR. Configuration is not supported.");
  } else {
    rpio.open(this.openDoorSensorPin, rpio.INPUT, this.openDoorResistor);
    log("Door open sensor: Configured");
    log("    Door open sensor pin: " + this.openDoorSensorPin);
    log("    Door open sensor val: " + this.pinValueToString(this.openDoorSensorValue));
    log("    Door open resistor: " + this.internalResistorToString(this.openDoorResistor));
  }

  this.sensorPollInMs = (config["doorPollTime"] || 1) * 1000;
  this.doorOpensInMs = (config["doorOpenTime"] || 15) * 1000;
  log("Sensor poll in ms: " + this.sensorPollInMs);
  log("Door opens in ms: " + this.doorOpensInMs);

  this.cachedState = this.hasSensors? this.determineCurrentDoorState() : DoorState.CLOSED;
  this.log("Initial door state: " + this.doorStateToString(this.cachedState));
  this.targetState = this.cachedState === DoorState.CLOSED ? DoorState.CLOSED : DoorState.OPEN;
  this.operating = false;
  this.canActivateRelay = true;
  this.setFinalDoorStateTimer = null;
  this.finalStatePollCounter = (this.doorOpensInMs - this.doorOpensInMs % this.sensorPollInMs) / this.sensorPollInMs;
  this.finalStatePollInMs = (this.doorOpensInMs - this.doorOpensInMs % this.finalStatePollCounter) / this.finalStatePollCounter + 1;

  if (!this.hasRelay || !this.hasSensors) {
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

    if (this.hasSensors)
      setInterval(this.monitorDoorState.bind(this), this.sensorPollInMs);
    else
      this.currentDoorState.on('get',this.getCurrentStateError.bind(this));

    this.currentDoorState.on('change',this.currentStateChange.bind(this));

    if (this.hasRelay && this.hasSensors)
      this.targetDoorState.on('set', this.setTargetState.bind(this));
    else
      this.targetDoorState.on('set', this.setTargetStateError.bind(this));

    this.currentDoorState.updateValue(this.cachedState);
    this.targetDoorState.updateValue(this.targetState);
    
    return [this.infoService, this.openerService];
  },

  currentStateChange: function(state) {
    this.log("State changed from " + this.doorStateToString(state.oldValue) + " to " + this.doorStateToString(state.newValue));
  },

  hasOpenSensor : function() {
    return this.openDoorSensorPin !== undefined;
  },

  hasClosedSensor : function() {
    return this.closedDoorSensorPin !== undefined;
  },

  determineCurrentDoorState: function() {
    if (rpio.read(this.closedDoorSensorPin) === this.closedDoorSensorValue)
      return DoorState.CLOSED;
    else if (this.hasOpenSensor())
      return rpio.read(this.openDoorSensorPin) === this.openDoorSensorValue ? DoorState.OPEN : DoorState.STOPPED;
    else
      return DoorState.STOPPED;
  },

  monitorDoorState: function() {
    if (!this.operating) {
      let state = this.determineCurrentDoorState();
      if (this.cachedState !== state) {
        if (state === DoorState.OPEN || state === DoorState.CLOSED) {
          this.targetState = state;
          this.cachedState = state;
        } else {
          this.targetState = (this.cachedState === DoorState.CLOSED ? DoorState.OPEN : DoorState.CLOSED);
          state = (this.targetState === DoorState.CLOSED ? DoorState.CLOSING : DoorState.OPENING);
          this.setFinalDoorState();
        }
        this.log("External device changed door state to " + this.doorStateToString(state));
        this.targetDoorState.updateValue(this.targetState);
        this.currentDoorState.updateValue(state);
      }
    }
  },

  switchOn: function(...args) {
    if (this.canActivateRelay) {
      this.log("Turning on door relay, pin " + this.doorSwitchPin + " = " + this.relayOn);
      this.canActivateRelay = false;
      rpio.write(this.doorSwitchPin, this.relayOn);
      setTimeout(this.switchOff.bind(this), this.doorSwitchPressTimeInMs, ...args);
    }
  },

  switchOff: function(...args) {
    this.log("Turning off door relay, pin " + this.doorSwitchPin + " = " + this.relayOff);
    rpio.write(this.doorSwitchPin, this.relayOff);
    setTimeout(this.okToUseRelay.bind(this), this.relayIdleInMs, ...args);
  },

  okToUseRelay: function(callback, ...args) {
    this.log("Relay available");
    this.canActivateRelay = true;
    if (callback != null)
      callback(...args);
  },

  setFinalDoorState: function(callback, counter) {
    let check = counter != null;
    counter = check? counter : this.finalStatePollCounter;
    this.operating = true;
    let state = this.determineCurrentDoorState();
    if (check && (counter <= 0 || state === DoorState.CLOSED || state === DoorState.OPEN)) {
      if (state === this.targetState) {
        this.log("The door is " + this.doorStateToString(state));
      } else {
        this.log("Was trying to " + this.targetDoorStateToString(this.targetState) + " the door, but it is " + this.doorStateToString(state));
        if (callback != null && state !== DoorState.STOPPED) {
          callback();
          return;
        }
        this.targetState = state === DoorState.CLOSED? DoorState.CLOSED : DoorState.OPEN;
      }
      this.targetDoorState.updateValue(this.targetState);
      this.currentDoorState.updateValue(state);
      this.cachedState = state;
      this.operating = false;
    } else {
      this.setFinalDoorStateTimer = setTimeout(this.setFinalDoorState.bind(this), this.finalStatePollInMs, callback, --counter);
    }
  },

  moveDoors: function(callback) {
    this.switchOn();
    this.setFinalDoorState(callback);
  },

  setTargetState: function(target, callback) {
    let error = null;
    let state = this.determineCurrentDoorState();
    if (target === this.targetState && target === state && !this.operating) {
      this.targetDoorState.updateValue(target);
      this.currentDoorState.updateValue(state);
    } else {
      if (this.canActivateRelay) {
        this.log("Setting target state to " + this.targetDoorStateToString(target));
        clearTimeout(this.setFinalDoorStateTimer);
        this.targetState = target;
        this.currentDoorState.updateValue(target === DoorState.CLOSED ? DoorState.CLOSING : DoorState.OPENING);
        let execute = this.moveDoors.bind(this);
        if (this.operating)
          this.switchOn(execute, execute);
        else
          this.moveDoors(execute);
      } else {
        this.log("Attempting to " + this.targetDoorStateToString(target) + " the door while relay is operating. Ignoring.");
        error = new Error(HAPServerStatus.RESOURCE_BUSY);
      }
    }
    callback(error);
  },

  setTargetStateError: function(target, callback) {
    callback(new Error(HAPServerStatus.SERVICE_COMMUNICATION_FAILURE));
  },

  getCurrentStateError: function(callback) {
    callback(new Error(HAPServerStatus.SERVICE_COMMUNICATION_FAILURE));
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
